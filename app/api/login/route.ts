import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { username, password } = body as { username?: string; password?: string };

  if (!username || !password) {
    return NextResponse.json({ error: 'Faltan credenciales.' }, { status: 400 });
  }

  const validUser = process.env.APP_USERNAME ?? 'mario';
  const validPass = process.env.APP_PASSWORD;

  if (!validPass) {
    return NextResponse.json(
      { error: 'APP_PASSWORD no está configurado en el servidor.' },
      { status: 500 }
    );
  }

  const usernameMatch = username.trim().toLowerCase() === validUser.toLowerCase();
  const passwordMatch = password === validPass;

  if (usernameMatch && passwordMatch) {
    return NextResponse.json({ success: true, username: username.trim() });
  }

  await new Promise((r) => setTimeout(r, 300));
  return NextResponse.json(
    { error: 'Usuario o contraseña incorrectos. Intenta de nuevo, parce.' },
    { status: 401 }
  );
}
