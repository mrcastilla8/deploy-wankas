
/** Monotonic identity for profile reads; only the newest live request may commit. */
export class AuthRequestGuard {
  private generation = 0;
  private active = true;
  begin(): number { this.active = true; return ++this.generation; }
  isCurrent(generation: number): boolean { return this.active && generation === this.generation; }
  invalidate(): void { this.generation += 1; }
  dispose(): void { this.active = false; this.invalidate(); }
}

type AuthUser = { id: string; email?: string | null; user_metadata?: { name?: unknown } };
type AuthSession = { access_token: string; user: AuthUser } | null;
type AuthEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | string;
type Profile = { id: string; name: string | null; email: string | null; phone_number: string | null; role: string | null };

export type AuthViewUser = { id: string; email: string | null; name: string | null; phone_number: string | null; role: string | null };
export type AuthViewState = { user: AuthViewUser | null; isLoading: boolean };

export type AuthClient = {
  auth: {
    onAuthStateChange: (callback: (event: AuthEvent, session: AuthSession) => void) => { data: { subscription: { unsubscribe: () => void } } };
    getSession: () => Promise<{ data: { session: AuthSession }; error: unknown | null }>;
    signOut: () => Promise<{ error: unknown | null }>;
  };
  from: (table: string) => { select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => PromiseLike<{ data: Profile | null; error: unknown | null }> } } };
};

const PROFILE_FIELDS = 'id, name, email, phone_number, role';

/** Supabase Auth event/session lifecycle used by AuthProvider and tested with a controlled SDK double. */
export class AuthSessionController {
  private readonly client: AuthClient;
  private readonly onState: (state: AuthViewState) => void;
  private readonly invalidateCache: () => void;
  private readonly onLogoutError: () => void;
  private readonly onLogoutConfirmed: () => void;
  private state: AuthViewState = { user: null, isLoading: true };
  private mounted = false;
  private receivedAuthEvent = false;
  private initialSessionProcessed = false;
  private initialSessionKey: string | null = null;
  private authUserId: string | null = null;
  private sessionToken: string | null = null;
  private requestGuard = new AuthRequestGuard();
  private unsubscribe: (() => void) | undefined;

  constructor(
    client: AuthClient,
    onState: (state: AuthViewState) => void,
    invalidateCache: () => void,
    onLogoutError: () => void,
    onLogoutConfirmed: () => void,
  ) {
    this.client = client;
    this.onState = onState;
    this.invalidateCache = invalidateCache;
    this.onLogoutError = onLogoutError;
    this.onLogoutConfirmed = onLogoutConfirmed;
  }

  start(): () => void {
    this.mounted = true;
    this.receivedAuthEvent = false;
    const { data: { subscription } } = this.client.auth.onAuthStateChange((event, session) => {
      this.receivedAuthEvent = true;
      this.receiveEvent(session, event);
      // Defer work until Supabase releases its internal event lock.
      setTimeout(() => { void this.handleSession(session, event); }, 0);
    });
    this.unsubscribe = () => subscription.unsubscribe();
    void this.client.auth.getSession().then(({ data, error }) => {
      if (error) console.error('No se pudo recuperar la sesión de Supabase.');
      if (this.mounted && !this.receivedAuthEvent) void this.handleSession(data.session, 'INITIAL_SESSION');
    }).catch(() => {
      if (this.mounted && !this.receivedAuthEvent) {
        this.requestGuard.invalidate();
        this.publish({ user: null, isLoading: false });
      }
    });
    return () => this.dispose();
  }

  private publish(patch: Partial<AuthViewState>): void {
    this.state = { ...this.state, ...patch };
    if (this.mounted) this.onState(this.state);
  }

  private receiveEvent(session: AuthSession, _event: AuthEvent): void {
    const nextUserId = session?.user.id ?? null;
    const nextToken = session?.access_token ?? null;
    if (nextUserId === this.authUserId) {
      if (nextToken !== this.sessionToken) this.requestGuard.invalidate();
      this.sessionToken = nextToken;
      return;
    }
    this.authUserId = nextUserId;
    this.sessionToken = nextToken;
    this.requestGuard.invalidate();
    this.invalidateCache();
    this.publish({ user: null, isLoading: nextUserId !== null ? true : false });
  }

  private async handleSession(session: AuthSession, event: AuthEvent): Promise<void> {
    if (!this.mounted) return;
    const authUser = session?.user ?? null;
    const nextUserId = authUser?.id ?? null;
    const nextToken = session?.access_token ?? null;
    // Deferred callbacks from an older event must not start work after a newer identity event.
    if (this.receivedAuthEvent && (nextUserId !== this.authUserId || nextToken !== this.sessionToken)) return;
    if (event === 'INITIAL_SESSION') {
      const sessionKey = session ? `${session.user.id}:${session.access_token}` : null;
      if (this.initialSessionProcessed && this.initialSessionKey === sessionKey) return;
      this.initialSessionProcessed = true;
      this.initialSessionKey = sessionKey;
    }

    const identityChanged = nextUserId !== this.authUserId;
    if (identityChanged) {
      this.authUserId = nextUserId;
      this.sessionToken = nextToken;
      this.publish({ user: null, ...(nextUserId ? { isLoading: true } : {}) });
    } else if (!this.receivedAuthEvent) {
      this.sessionToken = nextToken;
    }

    const requestGeneration = this.requestGuard.begin();
    this.invalidateCache();
    if (!authUser) {
      this.publish({ user: null, isLoading: false });
      return;
    }

    queueMicrotask(async () => {
      try {
        const { data: profile, error } = await this.client.from('profiles').select(PROFILE_FIELDS).eq('id', authUser.id).maybeSingle();
        if (error) console.error('No se pudo hidratar el perfil del usuario autenticado.');
        if (!this.mounted || !this.requestGuard.isCurrent(requestGeneration)) return;
        this.publish({ user: this.toViewUser(authUser, error ? null : profile) });
      } catch {
        if (this.mounted && this.requestGuard.isCurrent(requestGeneration)) this.publish({ user: this.toViewUser(authUser, null) });
      } finally {
        if (this.mounted && this.requestGuard.isCurrent(requestGeneration)) this.publish({ isLoading: false });
      }
    });
  }

  private toViewUser(authUser: AuthUser, profile: Profile | null): AuthViewUser {
    return {
      id: authUser.id,
      email: profile?.email ?? authUser.email ?? null,
      name: profile?.name ?? (typeof authUser.user_metadata?.name === 'string' ? authUser.user_metadata.name : null),
      phone_number: profile?.phone_number ?? null,
      role: profile?.role ?? null,
    };
  }

  async logout(): Promise<boolean> {
    try {
      const { error } = await this.client.auth.signOut();
      if (error) {
        console.error('No se pudo cerrar la sesión de Supabase.');
        this.onLogoutError();
        return false;
      }
      this.authUserId = null;
      this.sessionToken = null;
      this.requestGuard.invalidate();
      this.invalidateCache();
      this.publish({ user: null, isLoading: false });
      this.onLogoutConfirmed();
      return true;
    } catch {
      console.error('No se pudo cerrar la sesión de Supabase.');
      this.onLogoutError();
      return false;
    }
  }

  dispose(): void {
    if (!this.mounted) return;
    this.mounted = false;
    this.requestGuard.dispose();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}
