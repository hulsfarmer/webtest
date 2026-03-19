import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { CustomSupabaseAdapter } from './supabase-adapter';
import { supabase } from './supabase';

const providers = [
  GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
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
      // 기존 사용자의 이메일/이름이 비어있으면 프로필에서 업데이트
      // (카카오 이메일 권한이 나중에 추가된 경우 대응)
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
      // 최초 로그인 시 user 객체에서 id를 토큰에 저장
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  debug: process.env.NODE_ENV === 'development',
};
