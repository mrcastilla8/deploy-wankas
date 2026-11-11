type RegistrationAuth = {
  signUp: (credentials: {
    email: string;
    password: string;
    options: { data: { name: string } };
  }) => Promise<{
    data: { user: unknown | null; session: unknown | null };
    error: { message: string } | null;
  }>;
};

type RegistrationHandlers = {
  onAuthenticated: () => void;
  onConfirmationRequired: () => void;
  onError: (error: { message: string }) => void;
  onUnexpected: () => void;
};

/** Execute the Supabase registration contract and dispatch its real outcome to the form. */
export async function registerWithSupabase(
  auth: RegistrationAuth,
  credentials: { email: string; password: string; name: string },
  handlers: RegistrationHandlers,
): Promise<void> {
  const { data, error } = await auth.signUp({
    email: credentials.email,
    password: credentials.password,
    options: { data: { name: credentials.name } },
  });

  if (error) handlers.onError(error);
  else if (data.session) handlers.onAuthenticated();
  else if (data.user) handlers.onConfirmationRequired();
  else handlers.onUnexpected();
}
