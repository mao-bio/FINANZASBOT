import os
import json
import asyncio
from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, filters, ContextTypes
from dotenv import load_dotenv
from database import AsyncSessionLocal
from models import Transaction
import google.generativeai as genai

load_dotenv()
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN", "MOCK_TOKEN")
ADMIN_TELEGRAM_ID = os.getenv("ADMIN_TELEGRAM_ID", "")
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

# Usamos el modelo moderno y rápido de Gemini que soporta texto, audio y visión
model = genai.GenerativeModel('gemini-2.5-flash')

async def verify_user(update: Update) -> bool:
    if str(update.message.from_user.id) != ADMIN_TELEGRAM_ID:
        await update.message.reply_text("⛔ Acceso denegado. No tienes permiso para usar este bot.")
        return False
    return True

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await verify_user(update): return
    await update.message.reply_text(
        "¡Hola! Soy tu asistente financiero impulsado por IA. 🤑\n"
        "Puedes enviarme:\n"
        "1️⃣ Textos: 'Gasolina 50 mil hoy', 'Me pagaron 1.5M'\n"
        "2️⃣ Audios: 'Fui al súper y gasté veinte mil'\n"
        "3️⃣ Fotos: Una factura, yo la leo por ti."
    )

from sqlalchemy import select, extract
import datetime
from models import Transaction, FixedExpense

async def get_monthly_summary(session):
    now = datetime.datetime.utcnow()
    result = await session.execute(select(Transaction))
    transactions = [t for t in result.scalars().all() if t.date.year == now.year and t.date.month == now.month]
    
    fe_result = await session.execute(select(FixedExpense))
    fixed_expenses = fe_result.scalars().all()

    ingresos = sum(t.amount for t in transactions if t.type == 'ingreso')
    gastos = sum(t.amount for t in transactions if t.type == 'gasto')
    gastos_cat = {}
    for t in transactions:
        if t.type == 'gasto':
             gastos_cat[t.category] = gastos_cat.get(t.category, 0) + t.amount

    summary = (
        f"--- ESTADO FINANCIERO DEL MES ({now.month}/{now.year}) ---\n"
        f"- Total Ingresos: ${ingresos:,.0f}\n"
        f"- Total Gastos: ${gastos:,.0f}\n"
        f"- Saldo Restante: ${(ingresos-gastos):,.0f}\n"
        f"- Gastos por Categoría: {gastos_cat}\n"
        f"- Gastos Fijos (Plantillas): {[fe.description + ' $' + str(fe.amount) for fe in fixed_expenses]}\n"
        "--------------------------------------\n"
    )
    return summary

async def _process_ai_decision(update: Update, prompt_text: str, file_uri=None, media_parts=None):
    """ Función auxiliar para llamar a Gemini y guardar en Base de Datos """
    msg_status = await update.message.reply_text("🧠 Analizando con IA...")
    
    async with AsyncSessionLocal() as session:
        summary_text = await get_monthly_summary(session)

    system_instruction = (
        f"Eres un asesor financiero personal con IA. Primero revisa el contexto actual del usuario:\n{summary_text}\n"
        "Tu tarea final es responder SOLO con un JSON válido para ejecutar una acción en la App.\n"
        "Campos JSON:\n"
        "- action: 'create' (registro normal), 'create_fixed' (gasto recurrente que se cobra cada mes), 'update_latest' (corregir), 'delete_latest' (borrar), o 'answer' (si hace preguntas financieras).\n"
        "- amount: (número float, si aplica)\n"
        "- type: ('gasto' o 'ingreso', si aplica)\n"
        "- category: (ej: 'Comida', 'Hogar', 'Salario', etc)\n"
        "- description: (resumen corto de 1-2 palabras)\n"
        "- message: (Si la action es 'answer', coloca aquí una respuesta útil, motivadora y conversacional hablándole sobre sus finanzas, basado estrictamente en el ESTADO FINANCIERO proveído. No uses markdown de json ni lo incluyas fuera del payload).\n\n"
        "Reglas:\n"
        "1. Si te dicen 'agrega X como gasto fijo' -> action: create_fixed\n"
        "2. Si hacen una pregunta (ej: 'cuánto he gastado', 'me sobra plata') -> action: answer, y responde naturalmente en 'message'.\n"
        "3. Acciones de borrar ('me equivoqué borra eso') -> action: delete_latest\n"
        "No mandes texto fuera del bloque de JSON."
    )
    
    try:
        if media_parts:
            contents = media_parts
            contents.append(system_instruction + "\n\nEntrada del usuario: " + prompt_text)
            response = await model.generate_content_async(contents)
        else:
            response = await model.generate_content_async(
                system_instruction + "\n\nEntrada del usuario: " + prompt_text
            )
            
        json_resp = response.text.strip()
        if json_resp.startswith("```json"): json_resp = json_resp[7:]
        if json_resp.endswith("```"): json_resp = json_resp[:-3]
        
        data = json.loads(json_resp.strip())
        
        if "error" in data:
            await msg_status.edit_text(f"🤔 {data['error']}. Prueba ser más específico.")
            return

        action = data.get("action", "create")
        
        async with AsyncSessionLocal() as session:
            if action == "delete_latest":
                last_t = await session.execute(select(Transaction).order_by(Transaction.id.desc()).limit(1))
                last_t = last_t.scalar_one_or_none()
                if last_t:
                    await session.delete(last_t)
                    await session.commit()
                    await msg_status.edit_text("🗑️✅ El último registro ha sido eliminado exitosamente.")
                else:
                    await msg_status.edit_text("⚠️ No hay registros para eliminar.")
                return

            elif action == "update_latest":
                last_t = await session.execute(select(Transaction).order_by(Transaction.id.desc()).limit(1))
                last_t = last_t.scalar_one_or_none()
                if last_t:
                    if "amount" in data: last_t.amount = float(data["amount"])
                    if "type" in data: last_t.type = data["type"].lower()
                    if "category" in data: last_t.category = data["category"].capitalize()
                    if "description" in data: last_t.description = data["description"]
                    await session.commit()
                    icon = "📈" if last_t.type == "ingreso" else "📉"
                    await msg_status.edit_text(
                        f"✏️✅ **Último registro corregido**:\n\n"
                        f"💰 **Monto**: ${last_t.amount:,.0f}\n"
                        f"📂 **Categoría**: {last_t.category}\n"
                        f"📝 **Detalle**: {last_t.description}\n"
                        f"{icon} **Tipo**: {last_t.type.capitalize()}",
                        parse_mode="Markdown"
                    )
                else:
                    await msg_status.edit_text("⚠️ No hay registros para actualizar.")
                return

            elif action == "answer":
                await msg_status.edit_text(f"🗣️ {data.get('message', 'No parece haber una respuesta procesable.')}")
                return
                
            elif action == "create_fixed":
                amount = float(data.get("amount", 0))
                category = data.get("category", "Otros").capitalize()
                desc = data.get("description", "Gasto Fijo")
                
                if amount > 0:
                    new_fe = FixedExpense(user_id=1, amount=amount, category=category, description=desc)
                    session.add(new_fe)
                    await session.commit()
                    await msg_status.edit_text(
                         f"📌✅ **Plantilla Fija Creada**:\n"
                         f"Este gasto se procesará automáticamente todos los meses.\n"
                         f"💰 **Monto**: ${amount:,.0f}\n"
                         f"📂 **Categoría**: {category}\n"
                         f"📝 **Plan**: {desc}\n",
                         parse_mode="Markdown"
                    )
                else: 
                    await msg_status.edit_text("🤔 Entendí que es fijo, pero me faltó el monto numérico.")
                return

            else:
                amount = float(data.get("amount", 0))
                ttype = data.get("type", "gasto").lower()
                category = data.get("category", "Otros").capitalize()
                desc = data.get("description", "")
                
                if amount > 0:
                     new_tx = Transaction(user_id=1, amount=amount, type=ttype, category=category, description=desc)
                     session.add(new_tx)
                     await session.commit()
                     icon = "📈" if ttype == "ingreso" else "📉"
                     await msg_status.edit_text(
                         f"✅ **Registrado por IA**:\n\n"
                         f"💰 **Monto**: ${amount:,.0f}\n"
                         f"📂 **Categoría**: {category}\n"
                         f"📝 **Detalle**: {desc}\n"
                         f"{icon} **Tipo**: {ttype.capitalize()}",
                         parse_mode="Markdown"
                     )
                else:
                     await msg_status.edit_text("🤔 Pude identificar la acción pero no el monto numérico válido.")

    except json.JSONDecodeError:
        await msg_status.edit_text("⚠️ Hubo un problema comprendiendo la instrucción. Intenta de nuevo.")
    except Exception as e:
        await msg_status.edit_text(f"❌ Error de IA: {str(e)}")

async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await verify_user(update): return
    await _process_ai_decision(update, update.message.text)

async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await verify_user(update): return
    
    photo_file = await update.message.photo[-1].get_file()
    # Download in memory or temp file
    file_bytes = await photo_file.download_as_bytearray()
    
    # Send image to Gemini inline
    media_parts = [{
        "mime_type": "image/jpeg",
        "data": bytes(file_bytes)
    }]
    
    prompt = update.message.caption or "Analiza esta factura o comprobante."
    await _process_ai_decision(update, prompt, media_parts=media_parts)

async def handle_voice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await verify_user(update): return
    
    voice_file = await update.message.voice.get_file()
    file_bytes = await voice_file.download_as_bytearray()
    # Gemini 2.x natively supports Audio!
    media_parts = [{
        "mime_type": "audio/ogg", 
        "data": bytes(file_bytes)
    }]
    
    prompt = "Interpreta este audio en español donde describo una transacción."
    await _process_ai_decision(update, prompt, media_parts=media_parts)


def run_bot():
    if TELEGRAM_TOKEN == "MOCK_TOKEN":
        print("Bot token is mock. Set TELEGRAM_TOKEN in .env")
        return
    app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()
    
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & (~filters.COMMAND), handle_text))
    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    app.add_handler(MessageHandler(filters.VOICE, handle_voice))
    
    print("🤖 Bot de Telegram con IA de Gemini en ejecución...")
    app.run_polling()

if __name__ == "__main__":
    run_bot()
