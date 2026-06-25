import { NextResponse } from 'next/server';

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';

const headers: Record<string, string> = {
  'apikey': supabaseKey,
  'Authorization': `Bearer ${supabaseKey}`,
  'Content-Type': 'application/json',
};

export async function DELETE() {
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Supabase not configured.' }, { status: 500 });
  }

  try {
    // Delete ALL transactions (user_id=1 is the single user in this app)
    const res = await fetch(`${supabaseUrl}/rest/v1/transactions?user_id=eq.1`, {
      method: 'DELETE',
      headers,
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Supabase error: ${text}` }, { status: res.status });
    }

    return NextResponse.json({ success: true, message: 'Todas las transacciones han sido eliminadas.' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
