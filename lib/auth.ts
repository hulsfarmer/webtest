import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { CustomSupabaseAdapter } from './supabase-adapter';
import { supabase } from './supabase';
import { isAdminEmail } from './admin';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const providers: any[] = [
  GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  }),
  // 이메일/비밀번호 로그인 (poimen 구조 참조)
  CredentialsProvider({
    name: 'credentials',
    credentials: {
      email: { label: '이메일', type: 'email' },
      password: { label: '비밀번호', type: 'password' },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) return null;
      const email = String(credentials.email).trim().toLowerCase();

      const { data: user } = await supabase
        .from('users')
        .select('id, email, name, image, password_hash')
        .eq('email', email)
        .single();

      if (!user || !user.password_hash) return null;

      const ok = await bcrypt.compare(String(credentials.password), user.password_hash);
      if (!ok) return null;

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image ?? null,
      };
    },
  }),
];

// Kakao는 REST API 키가 있을 때만 활성화
if (process.env.KAKAO_CLIENT_ID) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const KakaoProvider = require('next-auth/providers/kakao').default;
  providers.push(
    KakaoProvider({
      clientId: process.env.KAKAO_CLIENT_ID,
      clientSecret: process.env.KAKAO_CLIENT_SECRET || '',
    })
  );
}

export const authOptions: NextAuthOptions = {
  adapter: CustomSupabaseAdapter(),
  providers,
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async signIn({ user, profile }) {
      // OAuth: 기존 사용자의 이메일/이름이 비어있으면 프로필에서 업데이트
      if (user?.id && profile) {
        const { data: existing } = await supabase
          .from('users')
          .select('email, name')
          .eq('id', user.id)
          .single();

        if (existing) {
          const updates: Record<string, string> = {};
          if (!existing.email && (profile.email || user.email)) {
            updates.email = (profile.email || user.email) as string;
          }
          if (!existing.name && (profile.name || user.name)) {
            updates.name = (profile.name || user.name) as string;
          }
          if (Object.keys(updates).length > 0) {
            await supabase.from('users').update(updates).eq('id', user.id);
            console.log(`[Auth] Updated user ${user.id}:`, updates);
          }
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as { isAdmin?: boolean }).isAdmin = isAdminEmail(session.user.email);
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  debug: process.env.NODE_ENV === 'development',
};
