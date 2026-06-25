import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import Anthropic from '@anthropic-ai/sdk';

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

// ─── Server-side transaction detector (does NOT rely on LLM output) ────────────
interface DetectedTx {
  tipo: 'ingreso' | 'gasto';
  monto: number;
  categoria: string;
  descripcion: string;
}

function parseAmountFromText(text: string): number | null {
  // Normalize
  const t = text.toLowerCase()
    .replace(/\./g, '')   // remove thousands dots
    .replace(/,/g, '.');  // normalize decimal comma

  // Match patterns like: 500000, 500k, 500 mil, 2 millones, 1.5M, 2 palos
  const patterns: Array<[RegExp, number]> = [
    [/(\d+(?:\.\d+)?)\s*(?:millones?|palos?)\b/, 1_000_000],
    [/(\d+(?:\.\d+)?)\s*(?:mil|k|lucas)\b/, 1_000],
    [/(\d+(?:\.\d+)?)M\b/, 1_000_000],
    [/(\d+(?:\.\d+)?)\b/, 1],
  ];

  for (const [re, multiplier] of patterns) {
    const m = t.match(re);
    if (m) {
      const num = parseFloat(m[1]) * multiplier;
      if (num > 0) return Math.round(num);
    }
  }
  return null;
}

function detectTransaction(userMessage: string): DetectedTx | null {
  const msg = userMessage.toLowerCase().trim();

  // ── SAVINGS (special — tracked as ingreso type:ahorro) ────────────────────────
  // Must come first so "ahorré" doesn't match generic income
  const savingsPatterns: RegExp[] = [
    /(?:tengo\s+ahorrado|ahorr[eé]|met[ií]\s+a\s+ahorros|guard[eé]|separ[eé]\s+para\s+ahorros)/,
  ];
  for (const pattern of savingsPatterns) {
    if (pattern.test(msg)) {
      const monto = parseAmountFromText(msg);
      if (monto && monto >= 100) {
        return { tipo: 'ingreso', monto, categoria: 'Ahorros', descripcion: 'ahorros' };
      }
    }
  }

  // ── INCOME patterns ───────────────────────────────────────────────────────────
  const incomePatterns: Array<[RegExp, string, string]> = [
    [/(?:recib[ií]|me\s+pagaron|me\s+cay[oó]|me\s+entr[oó]|cobr[eé]).*?(?:salario|sueldo|quincena|n[oó]mina)/, 'Salario', 'salario'],
    [/(?:me\s+dieron|me\s+pagaron|recib[ií]|gan[eé]|hoy\s+me\s+dieron|me\s+entr[oó]|me\s+cay[oó]|ingres[eé])\s+[\d]/, 'Otros ingresos', 'ingreso recibido'],
    [/(?:vend[ií]|cobr[eé]\s+negocio|me\s+pag[oó]\s+el\s+negocio|comisi[oó]n|freelance)/, 'Negocios', 'ingreso negocio'],
    [/(?:arrend[eé]|canon\s+de\s+arrendamiento|alquil[eé])/, 'Arriendo recibido', 'arriendo recibido'],
  ];

  for (const [pattern, categoria, descripcion] of incomePatterns) {
    if (pattern.test(msg)) {
      const monto = parseAmountFromText(msg);
      if (monto && monto >= 100) {
        return { tipo: 'ingreso', monto, categoria, descripcion };
      }
    }
  }

  // ── EXPENSE patterns (ordered from most specific to most generic) ─────────────
  const expensePatterns: Array<[RegExp, string, string]> = [

    // 🏠 Hogar
    [/(?:pagu[eé]|me\s+cost[oó]|cancel[eé]).*?(?:arriendo|arrendamiento)/, 'Hogar - Arriendo', 'arriendo'],
    [/(?:pagu[eé]|me\s+cost[oó]).*?(?:administraci[oó]n|admin)/, 'Hogar - Administración', 'administración'],
    [/(?:pagu[eé]|me\s+cost[oó]).*?(?:\bluz\b|energ[ií]a|epm|codensa|electricidad)/, 'Hogar - Luz', 'luz'],
    [/(?:pagu[eé]|me\s+cost[oó]).*?(?:\bagua\b|acueducto)/, 'Hogar - Agua', 'agua'],
    [/(?:pagu[eé]|me\s+cost[oó]).*?(?:\bgas\b|surtigas|vanti)/, 'Hogar - Gas', 'gas'],
    [/(?:pagu[eé]|me\s+cost[oó]).*?(?:internet|wifi|fibra|etb|claro|tigo|movistar).*?(?:internet|fibra|casa)/, 'Hogar - Internet', 'internet'],
    [/(?:pagu[eé]|me\s+cost[oó]).*?(?:tv\s+cable|cable|directv|win\s+sports|televisi[oó]n)/, 'Hogar - TV', 'tv cable'],
    [/(?:pagu[eé]|me\s+cost[oó]).*?(?:celular|telefon[ií]a|plan\s+celular|plan\s+datos|claro|tigo|movistar|wom)/, 'Hogar - Celular', 'plan celular'],
    [/(?:pagu[eé]|gast[eé]|me\s+cost[oó]).*?(?:mueble|electrodom[eé]stico|nevera|lavadora|sof[aá]|cama|colch[oó]n)/, 'Hogar - Otros', 'hogar'],

    // 🍽️ Comida
    [/(?:gast[eé]|pagu[eé]|compr[eé]|me\s+cost[oó]).*?(?:mercado|supermercado|jumbo|[eé]xito|d1|ara|alkosto|carulla|fruver|verduras|carnes)/, 'Comida - Mercado', 'mercado'],
    [/(?:ped[ií]|compr[eé]|pagu[eé]).*?(?:domicilio|rappi|ifood|uber\s+eats|didi\s+food|delivery)/, 'Comida - Domicilios', 'domicilio'],
    [/(?:gast[eé]|pagu[eé]|salimos|fui).*?(?:restaurante|caf[eé]|sushi|pizza|hamburguesa|almuerzo|cena|desayuno|crepes|wok|andrés)/, 'Comida - Salidas a comer', 'restaurante'],
    [/(?:compr[eé]|gast[eé]).*?(?:snack|dulce|mecato|chocolatina|gaseosa|tinto|caf[eé]\s+de\s+oficina)/, 'Comida - Otros', 'snacks'],

    // 🚗 Transporte
    [/(?:pagu[eé]|gast[eé]|me\s+cost[oó]).*?(?:gasolina|combustible|nafta|llenada|galones)/, 'Transporte - Gasolina', 'gasolina'],
    [/(?:pagu[eé]).*?(?:impuesto.*?veh[ií]culo|soat.*?carro|impuesto.*?carro)/, 'Transporte - Impuesto vehículo', 'impuesto vehículo'],
    [/(?:pagu[eé]).*?(?:seguro.*?carro|seguro.*?moto|seguro.*?veh[ií]culo|p[oó]liza.*?auto)/, 'Transporte - Seguro vehículo', 'seguro vehículo'],
    [/(?:pagu[eé]|gast[eé]).*?(?:parqueadero|parqu[eé]|estacionamiento)/, 'Transporte - Parqueadero', 'parqueadero'],
    [/(?:pagu[eé]|gast[eé]).*?(?:peaje|autopista)/, 'Transporte - Peajes', 'peaje'],
    [/(?:pagu[eé]|gast[eé]|llam[eé]).*?(?:uber|didi|beat|cabify|taxi|indriver)/, 'Transporte - Apps movilidad', 'taxi/app'],
    [/(?:pagu[eé]|gast[eé]).*?(?:bus|metro|transmilenio|mio|massivo|metro|bicicleta|cicla)/, 'Transporte - Público', 'transporte público'],
    [/(?:pagu[eé]|gast[eé]).*?(?:tiquete|pasaje\s+a\s+|pasaje\s+de\s+|viaje\s+a)/, 'Transporte - Otros', 'pasaje'],

    // 📺 Suscripciones
    [/(?:pagu[eé]|me\s+cobr[oó]|renov[eé]).*?(?:netflix)/, 'Suscripciones - Netflix', 'netflix'],
    [/(?:pagu[eé]|me\s+cobr[oó]|renov[eé]).*?(?:spotify)/, 'Suscripciones - Spotify', 'spotify'],
    [/(?:pagu[eé]|me\s+cobr[oó]|renov[eé]).*?(?:disney|disney\+)/, 'Suscripciones - Disney+', 'disney+'],
    [/(?:pagu[eé]|me\s+cobr[oó]|renov[eé]).*?(?:hbo|max)/, 'Suscripciones - HBO/Max', 'hbo max'],
    [/(?:pagu[eé]|me\s+cobr[oó]|renov[eé]).*?(?:youtube\s+premium|yt\s+premium)/, 'Suscripciones - YouTube Premium', 'youtube premium'],
    [/(?:pagu[eé]|me\s+cobr[oó]|renov[eé]).*?(?:apple\s+music|apple\s+tv|apple\s+one)/, 'Suscripciones - Apple', 'apple'],
    [/(?:pagu[eé]|me\s+cobr[oó]|renov[eé]).*?(?:rappi\s+prime|rappi\s+turbo)/, 'Suscripciones - Rappi', 'rappi prime'],
    [/(?:pagu[eé]|me\s+cobr[oó]|renov[eé]).*?(?:gimnasio|gym|crossfit|spinning|yoga|fitpass)/, 'Suscripciones - Gimnasio', 'gimnasio'],
    [/(?:pagu[eé]|me\s+cobr[oó]|renov[eé]).*?(?:suscripci[oó]n|membres[ií]a|plan\s+premium)/, 'Suscripciones - Otras', 'suscripción'],

    // ❤️ Donaciones
    [/(?:di[eé]|don[eé]|aport[eé]|ofren[dé][eé]).*?(?:iglesia|diezmo|ofrenda|pastor)/, 'Donaciones - Iglesia', 'iglesia/diezmo'],
    [/(?:di[eé]|don[eé]|aport[eé]).*?(?:fundaci[oó]n|ong|caridad|necesitado)/, 'Donaciones - Fundación', 'donación'],
    [/(?:le\s+mand[eé]|le\s+pas[eé]|le\s+di).*?(?:familia|mam[aá]|pap[aá]|hermano|abuela|abuel)/, 'Donaciones - Familia', 'ayuda familia'],

    // 🏥 Salud
    [/(?:pagu[eé]|me\s+cost[oó]).*?(?:eps|salud|m[eé]dico|cl[ií]nica|hospital|cita|consulta)/, 'Salud - EPS/Médico', 'médico'],
    [/(?:compr[eé]|pagu[eé]).*?(?:medicamento|medicina|droga|f[aá]rmaco|pastilla|jarabe|drogueria|farmacia)/, 'Salud - Medicamentos', 'medicamentos'],
    [/(?:me\s+hice|pagu[eé]).*?(?:examen|laboratorio|rx|radiograf[ií]a|eco|resonancia)/, 'Salud - Exámenes', 'examen médico'],
    [/(?:pagu[eé]).*?(?:optometría|[oó]ptico|lentes|gafas)/, 'Salud - Otros', 'salud visual'],

    // 📚 Educación
    [/(?:pagu[eé]).*?(?:matr[ií]cula|matr[ií]cula)/, 'Educación - Matrícula', 'matrícula'],
    [/(?:pagu[eé]).*?(?:pensi[oó]n|mensualidad\s+colegio|colegio)/, 'Educación - Pensión', 'pensión colegio'],
    [/(?:pagu[eé]).*?(?:semestre|universidad|carrera|posgrado|maestr[ií]a)/, 'Educación - Semestre', 'semestre'],
    [/(?:compr[eé]|pagu[eé]).*?(?:libro|cuaderno|l[aá]piz|materiales|\\butiles)/, 'Educación - Materiales', 'útiles'],
    [/(?:pagu[eé]|compr[eé]).*?(?:curso|capacitaci[oó]n|diplomado|taller|clase)/, 'Educación - Otros', 'curso'],

    // 💳 Deudas
    [/(?:pagu[eé]|abon[eé]).*?(?:tarjeta\s+de\s+cr[eé]dito|t[cd]c|mastercard|visa|amex)/, 'Deudas - Tarjeta crédito', 'tarjeta crédito'],
    [/(?:pagu[eé]|abon[eé]).*?(?:hipoteca|cr[eé]dito\s+de\s+vivienda|cr[eé]dito\s+hipotecario)/, 'Deudas - Crédito vivienda', 'crédito vivienda'],
    [/(?:pagu[eé]|abon[eé]).*?(?:cr[eé]dito.*?carro|cr[eé]dito.*?veh[ií]culo|cuota.*?carro)/, 'Deudas - Crédito vehículo', 'crédito vehículo'],
    [/(?:pagu[eé]|abon[eé]).*?(?:cr[eé]dito.*?celular|cuota.*?celular|financiaci[oó]n.*?celular)/, 'Deudas - Crédito celular', 'crédito celular'],
    [/(?:pagu[eé]|abon[eé]).*?(?:gota\s+a\s+gota|prestamista|deuda|cr[eé]dito|cuota)/, 'Deudas - Otras', 'deuda'],

    // 🎉 Entretenimiento
    [/(?:gast[eé]|pagu[eé]).*?(?:concierto|festival|show|evento|entrada|boleta)/, 'Entretenimiento - Conciertos', 'concierto'],
    [/(?:gast[eé]|pagu[eé]|fui\s+a).*?(?:viaje|hotel|hospedaje|vuelo|tiquete\s+de\s+avion|airbnb)/, 'Entretenimiento - Viajes', 'viaje'],
    [/(?:gast[eé]|pagu[eé]).*?(?:fiesta|rumba|discoteca|bar|antro|trago|licor|cerveza|aguardiente)/, 'Entretenimiento - Fiestas', 'rumba'],
    [/(?:gast[eé]|pagu[eé]).*?(?:motel|love\s+hotel|hostal)/, 'Entretenimiento - Motel', 'motel'],
    [/(?:compr[eé]|pagu[eé]).*?(?:cond[oó]n|preservativo)/, 'Entretenimiento - Otros', 'preservativos'],
    [/(?:gast[eé]|pagu[eé]|fui).*?(?:cine|pel[ií]cula|teatro|museo|parque\s+de\s+diversiones)/, 'Entretenimiento - Otros', 'entretenimiento'],

    // 🎁 Regalos
    [/(?:le\s+compr[eé]|le\s+di|regal[eé]).*?(?:mam[aá]|madre)/, 'Regalos - Mamá', 'regalo mamá'],
    [/(?:le\s+compr[eé]|le\s+di|regal[eé]).*?(?:pap[aá]|padre)/, 'Regalos - Papá', 'regalo papá'],
    [/(?:le\s+compr[eé]|le\s+di|regal[eé]).*?(?:novia|esposa|mam[aí]|nena|amor|mujer)/, 'Regalos - Novia/Esposa', 'regalo novia'],
    [/(?:le\s+compr[eé]|le\s+di|regal[eé]).*?(?:hijo|hija|ni[nñ]o|ni[nñ]a|beb[eé])/, 'Regalos - Hijos', 'regalo hijos'],
    [/(?:le\s+compr[eé]|le\s+di|regal[eé]).*?(?:hermano|hermana)/, 'Regalos - Hermanos', 'regalo hermano'],
    [/(?:le\s+compr[eé]|le\s+di|regal[eé]).*?(?:amigo|amiga|parce|parcero)/, 'Regalos - Amigos', 'regalo amigo'],
    [/(?:le\s+compr[eé]|le\s+di|regal[eé]).*?(?:ex\b|exnovia|exesposa)/, 'Regalos - Ex', 'regalo ex'],
    [/(?:le\s+compr[eé]|le\s+di|regal[eé]).*?(?:mozo|moza|amante|pinta|cach[ií])/, 'Regalos - Mozo/a', 'regalo mozo/a'],
    [/(?:compr[eé]|regal[eé]).*?(?:regalo|detalle|cumplea[nñ]os|navidad|amor\s+y\s+amistad)/, 'Regalos - Otros', 'regalo'],

    // 🏥 Salud (gimnasio va aquí también)
    [/(?:pagu[eé]|me\s+cobr[oó]).*?(?:gimnasio|gym|crossfit|spinning|yoga)/, 'Salud - Gimnasio', 'gimnasio'],

    // Generic fallback
    [/(?:gast[eé]|pagu[eé]|me\s+cost[oó])\s+[\d]/, 'Otros gastos', 'gasto'],
    [/^[\d].*\ben\b/, 'Otros gastos', 'gasto'],
  ];

  for (const [pattern, categoria, descripcion] of expensePatterns) {
    if (pattern.test(msg)) {
      const monto = parseAmountFromText(msg);
      if (monto && monto >= 100) {
        return { tipo: 'gasto', monto, categoria, descripcion };
      }
    }
  }

  return null;
}

// ─── API Route ─────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    let message = '';
    let audioBase64 = '';
    let audioMimeType = '';

    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      message = (formData.get('message') as string) || '';
      const audioFile = formData.get('audio') as File | null;
      if (audioFile) {
        const arrayBuffer = await audioFile.arrayBuffer();
        audioBase64 = Buffer.from(arrayBuffer).toString('base64');
        audioMimeType = audioFile.type || 'audio/webm';
      }
    } else {
      const body = await req.json();
      message = body.message || '';
    }

    if (!message && !audioBase64) {
      return NextResponse.json({ error: 'Message or audio is required' }, { status: 400 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured.' }, { status: 500 });
    }

    // 1. Detect transaction server-side (reliable, no LLM needed for this)
    const detectedTx = message ? detectTransaction(message) : null;

    // 2. Get current balance and last 50 transactions for context
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
        .select('id, type, amount, category, description, date')
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

    // 3. Build system prompt — LLM only needs to reply naturally, NOT to detect/emit transactions
    const isSavings = detectedTx?.categoria === 'Ahorros';
    const systemInstruction = `
Eres 'Aura', coach de finanzas personales para colombianos. Eres muy cercana, usas lenguaje colombiano informal ('parce', 'plata', 'de una', 'chévere', 'lucas', 'bacano').

SALDO ACTUAL DEL USUARIO: ${balanceFormatted} (${currentBalance} COP)
Cuando el usuario pregunte cuánto tiene, cuál es su saldo, o cómo va, dile directamente este saldo.

ÚLTIMAS TRANSACCIONES REGISTRADAS (más recientes primero):
${last50.length > 0 ? JSON.stringify(last50, null, 2) : 'Sin transacciones aún.'}

${detectedTx ? `NOTA: El sistema YA detectó y va a registrar automáticamente esta transacción:
- Tipo: ${detectedTx.tipo}
- Monto: $${detectedTx.monto.toLocaleString('es-CO')}
- Categoría: ${detectedTx.categoria}
${isSavings ? '- IMPORTANTE: Este es un AHORRO. Felicita al usuario especialmente por estar ahorrando, dile que lo registraste SEPARADO como ahorro y motívalo a seguir.' : 'Confirma al usuario que lo registraste y anímalo a seguir registrando.'}` : ''}

CATEGORÍAS DISPONIBLES (para responder consultas del usuario):
🏠 Hogar: Arriendo, Administración, Luz, Agua, Gas, Internet, TV, Celular, Otros
🍽️ Comida: Mercado, Domicilios, Salidas a comer, Otros
🚗 Transporte: Público, Gasolina, Impuesto vehículo, Seguro vehículo, Parqueadero, Peajes, Apps movilidad, Otros
📺 Suscripciones: Netflix, Spotify, Disney+, HBO/Max, YouTube Premium, Apple, Rappi, Gimnasio, Otras
❤️ Donaciones: Iglesia, Fundación, Familia, Otros
🏥 Salud: EPS/Médico, Medicamentos, Exámenes, Gimnasio, Otros
📚 Educación: Matrícula, Pensión, Semestre, Materiales, Otros
💳 Deudas: Tarjeta crédito, Crédito vivienda, Crédito vehículo, Crédito celular, Otras
🎉 Entretenimiento: Conciertos, Viajes, Fiestas, Motel, Otros
🎁 Regalos: Mamá, Papá, Novia/Esposa, Hijos, Hermanos, Amigos, Ex, Mozo/a, Otros
💰 Ahorros: (registrado SEPARADO, no cuenta como gasto)

INSTRUCCIONES:
- Responde de forma amigable, corta y directa (máximo 3 oraciones).
- Usa emojis con moderación.
- Si el usuario pregunta cuánto ha gastado en una categoría, suma las transacciones del historial de esa categoría y responde.
- Si el usuario pregunta por sus ahorros, busca transacciones con categoria 'Ahorros' en el historial.
- NO menciones que eres IA ni que 'no puedes' hacer algo que sí está en el historial.
`;

    // 4. Call Claude for the friendly reply
    const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    let responseText = '';

    if (audioBase64) {
      responseText = '🎙️ El procesamiento de audio no está disponible. Por favor escribe tu mensaje.\nEjemplo: "Gasolina 50 mil hoy" o "Me pagaron 1.5M"';
    } else {
      const stream = anthropicClient.messages.stream({
        model: 'claude-opus-4-8',
        max_tokens: 1024,
        system: systemInstruction,
        messages: [{ role: 'user', content: message }],
      });
      const msg = await stream.finalMessage();
      responseText = msg.content[0].type === 'text' ? msg.content[0].text : '';
    }

    // 5. Save transaction to Supabase if detected
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

    // 6. Also try to extract transaction from LLM audio response (for voice messages)
    if (!detectedTx && audioBase64) {
      const txMatch =
        responseText.match(/TRANSACTION:\s*(\{[^\n\r}]*\})/) ||
        responseText.match(/TRANSACTION:\s*(\{[\s\S]*?\})/);
      if (txMatch) {
        try {
          const txData = JSON.parse(txMatch[1]);
          if (txData.tipo && txData.monto && process.env.NEXT_PUBLIC_SUPABASE_URL) {
            const { data: newTx, error: insertError } = await supabase
              .from('transactions')
              .insert({
                type: txData.tipo,
                amount: Number(txData.monto),
                category: txData.categoria || 'Otros',
                description: txData.descripcion || '',
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
            }
          }
        } catch { /* ignore parse errors */ }
        responseText = responseText.replace(/TRANSACTION:\s*\{[\s\S]*?\}/, '').trim();
      }
    }

    // 7. Return result with updated balance
    const finalBalance = transaction ? await getBalance() : currentBalance;

    return NextResponse.json({
      reply: responseText,
      transaction,
      balance: finalBalance,
    });
  } catch (err: any) {
    console.error('Chat API Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
