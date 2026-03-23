from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from pydantic import BaseModel
import datetime
import uvicorn
import asyncio
from typing import List

from database import engine, Base, get_db, AsyncSessionLocal
from models import Transaction, User, FixedExpense
from bot import run_bot

app = FastAPI(title="Finanzas Personales API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def fixed_expenses_cron():
    """ Tarea en segundo plano que revisa y aplica gastos fijos automáticamente al inicio del mes """
    print("⏳ Iniciando servicio automático de gastos fijos mensuales.")
    while True:
        try:
            async with AsyncSessionLocal() as session:
                now = datetime.datetime.utcnow()
                result = await session.execute(select(Transaction))
                transactions = result.scalars().all()
                
                # Check if we already applied them this month
                applied_this_month = any(
                    t.description.endswith("(Fijo)") and 
                    t.date.year == now.year and 
                    t.date.month == now.month 
                    for t in transactions
                )
                
                if not applied_this_month:
                    fe_result = await session.execute(select(FixedExpense))
                    fixed_expenses = fe_result.scalars().all()
                    
                    if fixed_expenses:
                        print(f"🔄 Detectado nuevo mes sin gastos procesados. Aplicando {len(fixed_expenses)} gastos fijos...")
                        for fe in fixed_expenses:
                            new_tx = Transaction(
                                user_id=1,
                                amount=fe.amount,
                                type="gasto",
                                category=fe.category,
                                description=f"{fe.description} (Fijo)",
                                date=now
                            )
                            session.add(new_tx)
                        await session.commit()
                        print("✅ Gastos mensuales fijos procesados.")
        except Exception as e:
            print("❌ Error en cron automático de gastos: ", e)
            
        # Duerme 12 horas antes de volver a verificar para no saturar 
        await asyncio.sleep(43200)

@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
         await conn.run_sync(Base.metadata.create_all)
    # Arranca el chequeador de meses
    asyncio.create_task(fixed_expenses_cron())

@app.get("/api/balance")
async def get_balance(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Transaction))
    transactions = result.scalars().all()
    
    total_ingresos = 0
    total_gastos = 0
    desglose_ingresos = {}
    desglose_gastos = {}
    
    current_year = datetime.datetime.utcnow().year
    current_month = datetime.datetime.utcnow().month
    
    # Solo procesamos transacciones del mes actual para el dashboard, dando sentido a "Mes"
    for t in transactions:
        if t.date.year == current_year and t.date.month == current_month:
            amount = float(t.amount)
            if t.type == "ingreso":
                total_ingresos += amount
                desglose_ingresos[t.category] = desglose_ingresos.get(t.category, 0) + amount
            else:
                total_gastos += amount
                desglose_gastos[t.category] = desglose_gastos.get(t.category, 0) + amount
    
    return {
        "ingresos": total_ingresos,
        "gastos": total_gastos,
        "balance": total_ingresos - total_gastos,
        "desglose_ingresos": desglose_ingresos,
        "desglose_gastos": desglose_gastos
    }

@app.get("/api/transactions")
async def get_transactions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Transaction).order_by(Transaction.date.desc()))
    return result.scalars().all()

class TransactionCreate(BaseModel):
    amount: float
    type: str
    category: str
    description: str
    date: str

@app.post("/api/transactions")
async def create_transaction(tx: TransactionCreate, db: AsyncSession = Depends(get_db)):
    try:
        date_obj = datetime.datetime.fromisoformat(tx.date.replace('Z', '+00:00'))
    except:
        date_obj = datetime.datetime.utcnow()
        
    new_tx = Transaction(
        user_id=1, 
        amount=tx.amount, 
        type=tx.type.lower(), 
        category=tx.category, 
        description=tx.description, 
        date=date_obj
    )
    db.add(new_tx)
    await db.commit()
    return {"status": "success", "id": new_tx.id}

@app.delete("/api/transactions/{tx_id}")
async def delete_transaction(tx_id: int, db: AsyncSession = Depends(get_db)):
    tx = await db.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(status_code=404, detail="No encontrado")
    await db.delete(tx)
    await db.commit()
    return {"status": "success"}

@app.put("/api/transactions/{tx_id}")
async def update_transaction(tx_id: int, tx_data: TransactionCreate, db: AsyncSession = Depends(get_db)):
    tx = await db.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(status_code=404, detail="No encontrado")
    tx.amount = tx_data.amount
    tx.type = tx_data.type.lower()
    tx.category = tx_data.category
    tx.description = tx_data.description
    try:
        tx.date = datetime.datetime.fromisoformat(tx_data.date.replace('Z', '+00:00'))
    except: pass
    await db.commit()
    return {"status": "success"}

class FixedExpenseCreate(BaseModel):
    amount: float
    category: str
    description: str

@app.get("/api/fixed-expenses")
async def get_fixed_expenses(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(FixedExpense))
    return result.scalars().all()

@app.post("/api/fixed-expenses")
async def create_fixed_expense(fe: FixedExpenseCreate, db: AsyncSession = Depends(get_db)):
    new_fe = FixedExpense(
        user_id=1,
        amount=fe.amount,
        category=fe.category,
        description=fe.description
    )
    db.add(new_fe)
    await db.commit()
    return {"status": "success"}

@app.delete("/api/fixed-expenses/{fe_id}")
async def delete_fixed_expense(fe_id: int, db: AsyncSession = Depends(get_db)):
    fe = await db.get(FixedExpense, fe_id)
    if not fe:
        raise HTTPException(status_code=404, detail="No encontrado")
    await db.delete(fe)
    await db.commit()
    return {"status": "success"}

@app.put("/api/fixed-expenses/{fe_id}")
async def update_fixed_expense(fe_id: int, fe_data: FixedExpenseCreate, db: AsyncSession = Depends(get_db)):
    fe = await db.get(FixedExpense, fe_id)
    if not fe:
        raise HTTPException(status_code=404, detail="No encontrado")
    fe.amount = fe_data.amount
    fe.category = fe_data.category
    fe.description = fe_data.description
    await db.commit()
    return {"status": "success"}

@app.post("/api/fixed-expenses/apply")
async def apply_fixed_expenses(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(FixedExpense))
    fixed_expenses = result.scalars().all()
    count = 0
    now = datetime.datetime.utcnow()
    for fe in fixed_expenses:
        new_tx = Transaction(
            user_id=1,
            amount=fe.amount,
            type="gasto",
            category=fe.category,
            description=f"{fe.description} (Fijo)",
            date=now
        )
        db.add(new_tx)
        count += 1
    await db.commit()
    return {"status": "success", "applied_count": count}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
