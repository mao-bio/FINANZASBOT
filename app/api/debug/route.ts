import { NextResponse } from 'next/server';

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';

const headers: Record<string, string> = {
  'apikey': supabaseKey,
  'Authorization': `Bearer ${supabaseKey}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

export async function GET() {
  const results: any = {
    env: {
      hasSupabaseUrl: !!supabaseUrl,
      supabaseUrl: supabaseUrl || 'NOT SET',
      hasServiceKey: !!supabaseKey,
      serviceKeyPrefix: supabaseKey.substring(0, 14) + '...',
    },
    tests: {}
  };

  // Test 1: SELECT
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/transactions?select=*&limit=2&order=date.desc`, { headers });
    const text = await res.text();
    if (res.ok) {
      const data = JSON.parse(text);
      results.tests.select = { ok: true, rowsReturned: data.length, sample: data };
    } else {
      results.tests.select = { ok: false, status: res.status, body: text };
    }
  } catch (e: any) {
    results.tests.select = { ok: false, threw: e.message };
  }

  // Test 2: INSERT then DELETE
  try {
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/transactions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'ingreso',
        amount: 1,
        category: 'Test',
        description: 'diagnostic-delete-me',
        user_id: 1,
        date: new Date().toISOString(),
      }),
    });
    const insertText = await insertRes.text();
    if (insertRes.ok) {
      const rows = JSON.parse(insertText);
      const newId = rows?.[0]?.id;
      results.tests.insert = { ok: true, insertedId: newId };

      // Cleanup
      if (newId) {
        const delRes = await fetch(`${supabaseUrl}/rest/v1/transactions?id=eq.${newId}`, {
          method: 'DELETE',
          headers,
        });
        results.tests.insert.cleaned = delRes.ok;
      }
    } else {
      results.tests.insert = { ok: false, status: insertRes.status, body: insertText };
    }
  } catch (e: any) {
    results.tests.insert = { ok: false, threw: e.message };
  }

  return NextResponse.json(results);
}
