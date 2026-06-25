// Direct Supabase REST client — bypasses @supabase/supabase-js entirely.
// Compatible with both legacy JWT keys (eyJ...) and new sb_secret_ keys.
// Uses native fetch, same as curl does.

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';

const baseHeaders: Record<string, string> = {
  'apikey': supabaseKey,
  'Authorization': `Bearer ${supabaseKey}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

type SupabaseResult<T = any> = { data: T | null; error: { message: string; code: string; hint: string } | null };

async function restFetch<T = any>(
  method: string,
  path: string,
  body?: object
): Promise<SupabaseResult<T>> {
  const url = `${supabaseUrl}/rest/v1/${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: baseHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      let errBody: any = {};
      try { errBody = JSON.parse(text); } catch {}
      return { data: null, error: { message: errBody.message || `HTTP ${res.status}`, code: String(res.status), hint: errBody.hint || '' } };
    }
    const data = text ? JSON.parse(text) : null;
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: { message: err.message, code: 'FETCH_FAILED', hint: '' } };
  }
}

/** Fluent query builder — mirrors the supabase-js API surface used in this project */
class QueryBuilder<T = any> {
  private _table: string;
  private _select = '*';
  private _filters: string[] = [];
  private _order = '';
  private _limit = '';
  private _single = false;
  private _body?: object;
  private _method = 'GET';

  constructor(table: string) {
    this._table = table;
  }

  select(cols = '*') { this._select = cols; return this; }

  order(col: string, opts?: { ascending?: boolean }) {
    this._order = `order=${col}.${opts?.ascending === false ? 'desc' : 'asc'}`;
    return this;
  }

  limit(n: number) { this._limit = `limit=${n}`; return this; }

  eq(col: string, val: any) { this._filters.push(`${col}=eq.${encodeURIComponent(val)}`); return this; }

  single() { this._single = true; return this; }

  /** Used after insert(...) */
  _setInsert(body: object) { this._method = 'POST'; this._body = body; return this; }

  /** Build the query string */
  private _buildPath() {
    const qs: string[] = [`select=${this._select}`, ...this._filters];
    if (this._order) qs.push(this._order);
    if (this._limit) qs.push(this._limit);
    return `${this._table}?${qs.join('&')}`;
  }

  /** Execute the query — makes it thenable / awaitable */
  then<R>(
    resolve: (v: SupabaseResult<T>) => R,
    reject?: (e: any) => any
  ): Promise<R> {
    const run = async (): Promise<SupabaseResult<T>> => {
      if (this._method === 'POST') {
        // INSERT path
        const url = `${supabaseUrl}/rest/v1/${this._table}`;
        try {
          const res = await fetch(url, { method: 'POST', headers: baseHeaders, body: JSON.stringify(this._body) });
          const text = await res.text();
          if (!res.ok) {
            let e: any = {};
            try { e = JSON.parse(text); } catch {}
            return { data: null, error: { message: e.message || `HTTP ${res.status}`, code: String(res.status), hint: e.hint || '' } };
          }
          const rows = text ? JSON.parse(text) : null;
          const data = this._single && Array.isArray(rows) ? (rows[0] ?? null) : rows;
          return { data, error: null };
        } catch (err: any) {
          return { data: null, error: { message: err.message, code: 'FETCH_FAILED', hint: '' } };
        }
      }

      if (this._method === 'DELETE') {
        // DELETE path
        const qs = this._filters.join('&');
        const url = `${supabaseUrl}/rest/v1/${this._table}${qs ? '?' + qs : ''}`;
        try {
          const res = await fetch(url, { method: 'DELETE', headers: baseHeaders });
          if (!res.ok) {
            const text = await res.text();
            let e: any = {};
            try { e = JSON.parse(text); } catch {}
            return { data: null, error: { message: e.message || `HTTP ${res.status}`, code: String(res.status), hint: '' } };
          }
          return { data: null, error: null };
        } catch (err: any) {
          return { data: null, error: { message: err.message, code: 'FETCH_FAILED', hint: '' } };
        }
      }

      // SELECT path
      return restFetch<T>('GET', this._buildPath());
    };

    return run().then(resolve, reject);
  }
}

class InsertProxy<T = any> {
  private _qb: QueryBuilder<T>;

  constructor(table: string, body: object) {
    this._qb = new QueryBuilder<T>(table);
    this._qb['_method'] = 'POST';
    this._qb['_body'] = body;
  }

  select() { return this; }
  single() { this._qb.single(); return this; }

  then<R>(resolve: (v: SupabaseResult<T>) => R, reject?: (e: any) => any): Promise<R> {
    return (this._qb as any).then(resolve, reject);
  }
}

class DeleteProxy<T = any> {
  private table: string;
  private filters: string[] = [];

  constructor(table: string) {
    this.table = table;
  }

  eq(col: string, val: any) {
    this.filters.push(`${col}=eq.${encodeURIComponent(val)}`);
    return this;
  }

  then<R>(resolve: (v: SupabaseResult<T>) => R, reject?: (e: any) => any): Promise<R> {
    const qs = this.filters.join('&');
    const url = `${supabaseUrl}/rest/v1/${this.table}${qs ? '?' + qs : ''}`;
    const run = async () => {
      try {
        const res = await fetch(url, { method: 'DELETE', headers: baseHeaders });
        if (!res.ok) {
          const text = await res.text();
          let e: any = {};
          try { e = JSON.parse(text); } catch {}
          return { data: null, error: { message: e.message || `HTTP ${res.status}`, code: String(res.status), hint: '' } };
        }
        return { data: null, error: null };
      } catch (err: any) {
        return { data: null, error: { message: err.message, code: 'FETCH_FAILED', hint: '' } };
      }
    };
    return run().then(resolve, reject) as Promise<R>;
  }
}

/** Main client — mirrors supabase-js `.from()` API */
export const supabase = {
  from<T = any>(table: string) {
    return {
      select(cols = '*') {
        const qb = new QueryBuilder<T>(table);
        qb.select(cols);
        return qb;
      },
      insert(body: object) {
        return new InsertProxy<T>(table, body);
      },
      delete() {
        return new DeleteProxy<T>(table);
      },
    };
  },
};
