import { supabase } from './supabase';
import type { Adapter, AdapterUser, AdapterAccount, AdapterSession } from 'next-auth/adapters';

export function CustomSupabaseAdapter(): Adapter {
  return {
    async createUser(user: Omit<AdapterUser, 'id'>) {
      const { data, error } = await supabase
        .from('users')
        .insert({
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified?.toISOString() ?? null,
          image: user.image,
        })
        .select()
        .single();

      if (error) throw error;
      return toAdapterUser(data);
    },

    async getUser(id) {
      const { data } = await supabase
        .from('users')
        .select()
        .eq('id', id)
        .single();

      return data ? toAdapterUser(data) : null;
    },

    async getUserByEmail(email) {
      const { data } = await supabase
        .from('users')
        .select()
        .eq('email', email)
        .single();

      return data ? toAdapterUser(data) : null;
    },

    async getUserByAccount({ providerAccountId, provider }) {
      const { data: account } = await supabase
        .from('accounts')
        .select('userId')
        .eq('provider', provider)
        .eq('providerAccountId', providerAccountId)
        .single();

      if (!account) return null;

      const { data: user } = await supabase
        .from('users')
        .select()
        .eq('id', account.userId)
        .single();

      return user ? toAdapterUser(user) : null;
    },

    async updateUser(user) {
      const { data, error } = await supabase
        .from('users')
        .update({
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified?.toISOString() ?? null,
          image: user.image,
        })
        .eq('id', user.id!)
        .select()
        .single();

      if (error) throw error;
      return toAdapterUser(data);
    },

    async deleteUser(userId) {
      await supabase.from('users').delete().eq('id', userId);
    },

    async linkAccount(account: AdapterAccount) {
      await supabase.from('accounts').insert({
        userId: account.userId,
        type: account.type,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        refresh_token: account.refresh_token ?? null,
        access_token: account.access_token ?? null,
        expires_at: account.expires_at ?? null,
        token_type: account.token_type ?? null,
        scope: account.scope ?? null,
        id_token: account.id_token ?? null,
        session_state: (account.session_state as string) ?? null,
      });

      return account as AdapterAccount;
    },

    async unlinkAccount({ providerAccountId, provider }) {
      await supabase
        .from('accounts')
        .delete()
        .eq('provider', provider)
        .eq('providerAccountId', providerAccountId);
    },

    async createSession(session) {
      const { data, error } = await supabase
        .from('sessions')
        .insert({
          sessionToken: session.sessionToken,
          userId: session.userId,
          expires: session.expires.toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      return toAdapterSession(data);
    },

    async getSessionAndUser(sessionToken) {
      const { data: session } = await supabase
        .from('sessions')
        .select()
        .eq('sessionToken', sessionToken)
        .single();

      if (!session) return null;

      const { data: user } = await supabase
        .from('users')
        .select()
        .eq('id', session.userId)
        .single();

      if (!user) return null;

      return {
        session: toAdapterSession(session),
        user: toAdapterUser(user),
      };
    },

    async updateSession(session) {
      const updateData: Record<string, unknown> = {};
      if (session.expires) updateData.expires = session.expires.toISOString();
      if (session.userId) updateData.userId = session.userId;

      const { data } = await supabase
        .from('sessions')
        .update(updateData)
        .eq('sessionToken', session.sessionToken)
        .select()
        .single();

      return data ? toAdapterSession(data) : null;
    },

    async deleteSession(sessionToken) {
      await supabase.from('sessions').delete().eq('sessionToken', sessionToken);
    },

    async createVerificationToken(token) {
      const { data, error } = await supabase
        .from('verification_tokens')
        .insert({
          identifier: token.identifier,
          token: token.token,
          expires: token.expires.toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      return data ? { ...data, expires: new Date(data.expires) } : null;
    },

    async useVerificationToken({ identifier, token }) {
      const { data } = await supabase
        .from('verification_tokens')
        .delete()
        .eq('identifier', identifier)
        .eq('token', token)
        .select()
        .single();

      return data ? { ...data, expires: new Date(data.expires) } : null;
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toAdapterUser(data: any): AdapterUser {
  return {
    id: data.id,
    name: data.name,
    email: data.email,
    emailVerified: data.emailVerified ? new Date(data.emailVerified) : null,
    image: data.image,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toAdapterSession(data: any): AdapterSession {
  return {
    sessionToken: data.sessionToken,
    userId: data.userId,
    expires: new Date(data.expires),
  };
}
