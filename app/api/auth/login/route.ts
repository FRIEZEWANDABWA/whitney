import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const { username, password } = await request.json();

        const adminUsername = process.env.ADMIN_USERNAME;
        const adminPassword = process.env.ADMIN_PASSWORD;

        if (!adminUsername || !adminPassword) {
            console.error('Login route: ADMIN_USERNAME / ADMIN_PASSWORD not configured in environment.');
            return NextResponse.json({ success: false, error: 'Server auth is not configured' }, { status: 500 });
        }

        if (username === adminUsername && password === adminPassword) {
            const response = NextResponse.json({ success: true, message: 'Authenticated' });

            // Set a secure, HTTPOnly cookie that lasts for 30 days
            response.cookies.set({
                name: 'ai_executive_auth',
                value: 'frieze_verified_session',
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 60 * 60 * 24 * 30, // 30 Days
                path: '/',
            });

            return response;
        }

        return NextResponse.json({ success: false, error: 'Invalid credentials' }, { status: 401 });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}
