import os
import json
import asyncio
import base64
import anthropic
from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, filters, ContextTypes
from dotenv import load_dotenv
from database import AsyncSessionLocal
from models import Transaction
from sqlalchemy import select
import datetime
from models import Transaction, FixedExpense

load_dotenv()
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN", "MOCK_TOKEN")
ADMIN_TELEGRAM_ID = os.getenv("ADMIN_TELEGRAM_ID", "")

client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

async def verify_user(update: Update) -> bool:
    if str(update.message.from_user.id) != ADMIN_TELEGRAM_ID:
        await update.message.reply_text("⛔ Acceso denegado. No tienes permiso para usar este bot.")
        return False
    return True

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await verify_user(update): return
    await update.message.reply_text(
        "¡Hola! Soy tu asistente financiero impulsado por Claude AI. 🤑\n"
        "Puedes enviarme:\n"
        "1️⃣ Textos: 'Gasolina 50 mil hoy', 'Me pagaron 1.5M'\n"
        "2️⃣ Fotos: Una factura, yo la leo por ti."
    )

async def get_enhanced_financial_context(session):
    now = datetime.datetime.utcnow()
    three_months_ago = now - datetime.timedelta(days=90)
    result = await session.execute(
        select(Transaction).where(Transaction.date >= three_months_ago).order_by(Transaction.date.desc())
    )
    all_recent_tx = result.scalars().all()

    current_tx = [t for t in all_recent_tx if t.date.year == now.year and t.date.month == now.month]

    ingresos = sum(t.amount for t in current_tx if t.type == 'ingreso')
    gastos = sum(t.amount for t in current_tx if t.type == 'gasto')

    categorias = {}
    for t in current_tx:
        if t.type == 'gasto':
            categorias[t.category] = categorias.get(t.category, 0) + t.amount

    days_passed = now.day if now.day > 0 else 1
    projection = (gastos / days_passed) * 30

    context = (
        f"--- REPORTE DE COACH FINANCIERO ---\n"
        f"Mes Actual: {now.strftime('%B %Y')}\n"
        f"Balance Real: +${ingresos:,.0f} (Ingresos) / -${gastos:,.0f} (Gastos)\n"
        f"Saldo Disponible: ${(ingresos - gastos):,.0f}\n"
        f"Proyeccion a Fin de Mes: Si sigues asi, gastaras aproximadamente ${projection:,.0f} este mes.\n"
        f"Top Gastos por Categoria: {categorias}\n"
        f"Historial Reciente (Ultimas 5): {[f'{t.date.strftime('%d/%m')}: {t.description} (${t.amount})' for t in all_recent_tx[:5]]}\n"
        f"------------------------------------"
    )
    return context

async def _process_ai_decision(update: Update, prompt_text: str, image_parts=None):
    msg_status = await update.message.reply_text("🧠 Analizando con Claude AI...")

    async with AsyncSessionLocal() as session:
        summary_text = await get_enhanced_financial_context(session)

    system_instruction = (
        "Eres 'Aura', el Coach Financiero Personal mas avanzado del mundo. Hablas espanol de forma clara, motivadora y experta.\n\n"
        f"CONTEXTO FINANCIERO REAL DEL USUARIO:\n{summary_text}\n\n"
        "TU TAREA:\n"
        "Responde SIEMPRE con un objeto JSON compacto que contenga:\n"
        "1. 'action': 'create' (registro), 'create_fixed' (gasto recurrente), 'update_latest' (corregir), 'delete_latest' (borrar), o 'answer' (preguntas/consejos).\n"
        "2. 'amount', 'type', 'category', 'description' (si vas a registrar algo).\n"
        "3. 'message': SIEMPRE escribe aqui un mensaje humano. Si es un registro, confirma con un tip de ahorro o una palmadita en la espalda. "
        "Si es una pregunta ('answer'), actua como un mentor: analiza sus gastos, dile si va bien o mal comparado con sus ingresos, detecta peligros (micro-fugas) y dale 1 paso accionable para mejorar hoy.\n\n"
        "REGLAS DE ORO:\n"
        "- Se conversacional pero basado en DATOS.\n"
        "- Si el usuario gasta mucho en una categoria, llamale la atencion con elegancia.\n"
        "- Si detectas que su proyeccion mensual supera sus ingresos, adviertele urgentemente.\n"
        "- NO incluyas markdown de json en tu respuesta final, solo el objeto.\n"
    )

    try:
        content = image_parts + [{"type": "text", "text": prompt_text}] if image_parts else [{"type": "text", "text": prompt_text}]

        response = await client.messages.create(
            model="claude-opus-4-8",
            max_tokens=1024,
            system=system_instruction,
            messages=[{"role": "user", "content": content}],
        )

        json_resp = response.content[0].text.strip()
        if json_resp.startswith("```json"):
            json_resp = json_resp[7:]
        if json_resp.endswith("```"):
            json_resp = json_resp[:-3]

        data = json.loads(json_resp.strip())

        if "error" in data:
            await msg_status.edit_text(f"🤔 {data['error']}. Prueba ser mas especifico.")
            return

        action = data.get("action", "create")

        async with AsyncSessionLocal() as session:
            if action == "delete_latest":
                last_t = await session.execute(select(Transaction).order_by(Transaction.id.desc()).limit(1))
                last_t = last_t.scalar_one_or_none()
                if last_t:
                    await session.delete(last_t)
                    await session.commit()
                    await msg_status.edit_text("🗑️✅ El ultimo registro ha sido eliminado exitosamente.")
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
                        f"✏️✅ **Ultimo registro corregido**:\n\n"
                        f"💰 **Monto**: ${last_t.amount:,.0f}\n"
                        f"📂 **Categoria**: {last_t.category}\n"
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
                        f"Este gasto se procesara automaticamente todos los meses.\n"
                        f"💰 **Monto**: ${amount:,.0f}\n"
                        f"📂 **Categoria**: {category}\n"
                        f"📝 **Plan**: {desc}\n",
                        parse_mode="Markdown"
                    )
                else:
                    await msg_status.edit_text("🤔 Entendi que es fijo, pero me falto el monto numerico.")
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
                        f"📂 **Categoria**: {category}\n"
                        f"📝 **Detalle**: {desc}\n"
                        f"{icon} **Tipo**: {ttype.capitalize()}",
                        parse_mode="Markdown"
                    )
                else:
                    await msg_status.edit_text("🤔 Pude identificar la accion pero no el monto numerico valido.")

    except json.JSONDecodeError:
        await msg_status.edit_text("⚠️ Hubo un problema comprendiendo la instruccion. Intenta de nuevo.")
    except anthropic.RateLimitError:
        await msg_status.edit_text("⏳ Demasiadas solicitudes. Intenta en un momento.")
    except anthropic.APIStatusError as e:
        await msg_status.edit_text(f"❌ Error de IA ({e.status_code}): {e.message}")
    except Exception as e:
        await msg_status.edit_text(f"❌ Error: {str(e)}")


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await verify_user(update): return
    await _process_ai_decision(update, update.message.text)


async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await verify_user(update): return

    photo_file = await update.message.photo[-1].get_file()
    file_bytes = await photo_file.download_as_bytearray()

    image_parts = [{
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": "image/jpeg",
            "data": base64.b64encode(bytes(file_bytes)).decode("utf-8"),
        }
    }]

    prompt = update.message.caption or "Analiza esta factura o comprobante y extrae los datos de la transaccion."
    await _process_ai_decision(update, prompt, image_parts=image_parts)


async def handle_voice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await verify_user(update): return
    await update.message.reply_text(
        "🎙️ El procesamiento de audio no esta disponible. Por favor escribe tu mensaje.\n"
        "Ejemplo: 'Gasolina 50 mil hoy' o 'Me pagaron 1.5M'"
    )


def run_bot():
    if TELEGRAM_TOKEN == "MOCK_TOKEN":
        print("Bot token is mock. Set TELEGRAM_TOKEN in .env")
        return
    app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & (~filters.COMMAND), handle_text))
    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    app.add_handler(MessageHandler(filters.VOICE, handle_voice))

    print("🤖 Bot de Telegram con Claude AI en ejecucion...")
    app.run_polling(stop_signals=False)


if __name__ == "__main__":
    run_bot()
