import asyncio
from database import AsyncSessionLocal
from sqlalchemy.future import select
from models import Transaction

async def check():
    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(Transaction).order_by(Transaction.id.desc()).limit(1))
            t = result.scalar_one_or_none()
            if t:
                print(f"✅ ULTIMO REGISTRO ENCONTRADO: {t.description} - ${t.amount} ({t.date})")
            else:
                print("❌ LA BASE DE DATOS ESTÁ VACÍA.")
    except Exception as e:
        print(f"❌ ERROR AL CONECTAR: {str(e)}")

if __name__ == "__main__":
    asyncio.run(check())
