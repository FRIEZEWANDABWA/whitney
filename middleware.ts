import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const isLoginPage = request.nextUrl.pathname.startsWith('/login');
    const isApiCron = request.nextUrl.pathname.startsWith('/api/cron');
    const authCookie = request.cookies.get('ai_executive_auth');

    // 1. Unauthenticated users trying to access protected paths get bounced
    // Bypass for API Cron routes as they have their own header-based auth
    if (!authCookie && !isLoginPage && !isApiCron) {
        return NextResponse.redirect(new URL('/login', request.url));
    }

    // 2. Authenticated users trying to open the login page again get forwarded to their dashboard
    if (authCookie && isLoginPage) {
        return NextResponse.redirect(new URL('/dashboard', request.url));
    }

    return NextResponse.next();
}

// See "Matching Paths" below to learn more
export const config = {
    // Only lock down the Dashboard and the Admin Control Panel pages. Wait, and API routes? 
    // We let Vercel CRON ping unauthenticated, since they use Bearer tokens inside the HTTP Headers
    matcher: ['/dashboard/:path*', '/admin/:path*'],
};
