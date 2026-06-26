import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ─── Balance helper ────────────────────────────────────────────────────────────
async function getBalance(): Promise<number> {
  try {
    const { data: allTx, error } = await supabase
      .from('transactions')
      .select('type, amount');
    if (error || !allTx) return 0;
    return allTx.reduce((acc: number, tx: any) => {
      const amt = Number(tx.amount) || 0;
      if (tx.type === 'ingreso') return acc + amt;
      if (tx.type === 'gasto' || tx.type === 'egreso') return acc - amt;
      return acc;
    }, 0);
  } catch {
    return 0;
  }
}

interface DetectedTx {
  tipo: 'ingreso' | 'gasto';
  monto: number;
  categoria: string;
  descripcion: string;
}

// Catálogo de categorías disponibles (la IA debe escoger una de aquí)
const CATEGORIAS = `
Hogar - Arriendo, Hogar - Administración, Hogar - Luz, Hogar - Agua, Hogar - Gas, Hogar - Internet, Hogar - TV, Hogar - Celular, Hogar - Otros,
Comida - Mercado, Comida - Domicilios, Comida - Salidas a comer, Comida - Otros,
Transporte - Público, Transporte - Gasolina, Transporte - Apps movilidad, Transporte - Parqueadero, Transporte - Peajes, Transporte - Otros,
Suscripciones - Netflix, Suscripciones - Spotify, Suscripciones - Disney+, Suscripciones - Otras,
Donaciones - Iglesia, Donaciones - Familia, Donaciones - Otros,
Salud - EPS/Médico, Salud - Medicamentos, Salud - Gimnasio, Salud - Otros,
Educación - Matrícula, Educación - Pensión, Educación - Otros,
Deudas - Tarjeta crédito, Deudas - Crédito vivienda, Deudas - Otras,
Entretenimiento - Conciertos, Entretenimiento - Viajes, Entretenimiento - Fiestas, Entretenimiento - Otros,
Regalos - Otros,
Salario, Negocios, Arriendo recibido, Otros ingresos, Saldo inicial, Ahorros,
Otros gastos`.replace(/\s+/g, ' ').trim();

// ─── AI-based transaction extraction (entiende cualquier forma de escribir) ─────
async function extractTransaction(model: any, message: string): Promise<DetectedTx | null> {
  const prompt = `Eres un extractor de movimientos financieros. Analiza el mensaje de un usuario colombiano y determina si está reportando un movimiento de dinero (ingreso o gasto).

Mensaje del usuario: "${message}"

Responde ÚNICAMENTE con un objeto JSON válido, sin markdown, sin explicaciones, sin bloques de código. Formato exacto:
{"hayMovimiento": true/false, "tipo": "ingreso"/"gasto", "monto": numero_entero, "categoria": "texto", "descripcion": "texto"}

REGLAS:
- "hayMovimiento" es true SOLO si el usuario reporta dinero que recibió, gastó, ahorró, o que tiene/dispone. Saludos, preguntas ("¿cuánto tengo?", "¿en qué gasto más?") y charla general NO son movimientos → hayMovimiento:false.
- AHORROS (ahorré, ahorra, ahorro, metí a ahorros, guardé) = tipo "ingreso", categoria "Ahorros".
- "Tengo X", "dispongo de X", "me quedan X", "cuento con X" = tipo "ingreso", categoria "Saldo inicial".
- Salario/sueldo/quincena recibido = "ingreso", categoria "Salario".
- monto SIEMPRE en pesos colombianos como entero. Conversiones: "2 millones"=2000000, "1.5 millones"=1500000, "80 mil"=80000, "50k"=50000, "2 palos"=2000000, "500 lucas"=500000.
- categoria debe ser EXACTAMENTE una de esta lista: ${CATEGORIAS}
- Si es gasto y ninguna categoría aplica, usa "Otros gastos". Si es ingreso, "Otros ingresos".
- descripcion: máximo 3 palabras.
- Si hayMovimiento es false, pon los demás campos en null.`;

  try {
    const result = await model.generateContent(prompt);
    let text = (result.response.text() || '').trim();
    // Limpiar posibles fences de markdown
    text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    // Extraer el objeto JSON aunque venga con texto alrededor
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);

    if (!parsed.hayMovimiento) return null;
    const monto = Math.round(Number(parsed.monto));
    if (!monto || isNaN(monto) || monto < 100) return null;

    const tipo: 'ingreso' | 'gasto' = parsed.tipo === 'ingreso' ? 'ingreso' : 'gasto';
    return {
      tipo,
      monto,
      categoria: parsed.categoria || (tipo === 'ingreso' ? 'Otros ingresos' : 'Otros gastos'),
      descripcion: parsed.descripcion || (tipo === 'ingreso' ? 'ingreso' : 'gasto'),
    };
  } catch (e) {
    console.error('extractTransaction error:', e);
    return null;
  }
}

// ─── API Route ─────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    let message = '';
    let audioBase64 = '';

    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      message = (formData.get('message') as string) || '';
      const audioFile = formData.get('audio') as File | null;
      if (audioFile) {
        const arrayBuffer = await audioFile.arrayBuffer();
        audioBase64 = Buffer.from(arrayBuffer).toString('base64');
      }
    } else {
      const body = await req.json();
      message = body.message || '';
    }

    if (!message && !audioBase64) {
      return NextResponse.json({ error: 'Message or audio is required' }, { status: 400 });
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not configured.' }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Audio no soportado: pedir texto
    if (audioBase64 && !message) {
      return NextResponse.json({
        reply: '🎙️ El procesamiento de audio aún no está disponible. Por favor escríbeme tu movimiento.\nEjemplo: "Gasolina 50 mil hoy" o "Me llegaron 1.5 millones".',
        transaction: null,
        balance: await getBalance(),
      });
    }

    // 1. La IA extrae el movimiento (si lo hay)
    const detectedTx = await extractTransaction(model, message);

    // 2. Guardar en Supabase SOLO si se detectó un movimiento real
    let transaction = null;
    if (detectedTx && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      const { data: newTx, error: insertError } = await supabase
        .from('transactions')
        .insert({
          type: detectedTx.tipo,
          amount: detectedTx.monto,
          category: detectedTx.categoria,
          description: detectedTx.descripcion,
          user_id: 1,
          date: new Date().toISOString(),
        })
        .select()
        .single();

      if (!insertError && newTx) {
        transaction = {
          id: newTx.id,
          tipo: newTx.type,
          monto: newTx.amount,
          categoria: newTx.category,
          descripcion: newTx.description,
          created_at: newTx.date,
        };
      } else if (insertError) {
        console.error('Supabase insert error:', insertError);
      }
    }

    // 3. Saldo e historial DESPUÉS de guardar (refleja la realidad)
    const currentBalance = await getBalance();
    const balanceFormatted = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(currentBalance);

    let last50: any[] = [];
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      const { data, error } = await supabase
        .from('transactions')
        .select('type, amount, category, description, date')
        .order('date', { ascending: false })
        .limit(50);
      if (!error && data) {
        last50 = data.map((tx: any) => ({
          tipo: tx.type,
          monto: tx.amount,
          categoria: tx.category,
          descripcion: tx.description,
          fecha: tx.date,
        }));
      }
    }

    const isSavings = transaction?.categoria === 'Ahorros';

    // 4. Aura responde — SOLO puede confirmar lo que realmente se guardó
    const systemInstruction = `Eres 'Aura', coach de finanzas personales para colombianos. Hablas cercano e informal ('parce', 'plata', 'de una', 'chévere', 'lucas', 'bacano'). Respondes corto y directo (máximo 3 oraciones) y usas emojis con moderación.

SALDO ACTUAL DEL USUARIO: ${balanceFormatted}
Cuando pregunte cuánto tiene o cómo va, dile exactamente este saldo.

ÚLTIMAS TRANSACCIONES (más recientes primero):
${last50.length > 0 ? JSON.stringify(last50.slice(0, 30), null, 2) : 'Sin transacciones aún.'}

${transaction
  ? `SE ACABA DE REGISTRAR ESTE MOVIMIENTO (confírmalo con naturalidad):
- Tipo: ${transaction.tipo}
- Monto: $${Number(transaction.monto).toLocaleString('es-CO')}
- Categoría: ${transaction.categoria}
${isSavings ? '- Es un AHORRO: felicítalo especialmente y motívalo a seguir ahorrando.' : '- Confírmale que lo registraste y anímalo.'}`
  : `NO SE REGISTRÓ NINGÚN MOVIMIENTO en este mensaje (el usuario solo está saludando, preguntando o conversando).
REGLA CRÍTICA: NO digas que registraste, guardaste o anotaste nada. NO inventes montos. Solo responde a lo que pregunta o conversa normal.`}

REGLAS:
- Si pregunta cuánto gastó en una categoría, suma del historial y responde.
- Si pregunta por ahorros, busca categoría 'Ahorros' en el historial.
- NUNCA afirmes haber guardado algo si arriba dice que no se registró nada.
- No menciones que eres una IA.

Mensaje del usuario: "${message}"`;

    let responseText = '';
    try {
      const result = await model.generateContent(systemInstruction);
      responseText = (result.response.text() || '').trim();
    } catch (e) {
      console.error('reply generation error:', e);
      responseText = transaction
        ? `Listo parce, registré $${Number(transaction.monto).toLocaleString('es-CO')} en "${transaction.categoria}". 👍`
        : 'Uy parce, no te entendí bien. ¿Me lo repites? 😅';
    }

    return NextResponse.json({
      reply: responseText,
      transaction,
      balance: currentBalance,
    });
  } catch (err: any) {
    console.error('Chat API Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
