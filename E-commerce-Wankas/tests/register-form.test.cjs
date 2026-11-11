const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

const filename = join(__dirname, '../src/components/auth/register-form.tsx');
const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
});

const registrationFlowFilename = join(__dirname, '../src/lib/registrationFlow.ts');
const registrationFlowSource = readFileSync(registrationFlowFilename, 'utf8');
const registrationFlowExports = {};
runInNewContext(ts.transpileModule(registrationFlowSource, {
  fileName: registrationFlowFilename,
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: registrationFlowExports }, { filename: registrationFlowFilename });

function findForm(element) {
  if (element?.type === 'form') return element;
  const children = element?.props?.children;
  return (Array.isArray(children) ? children : [children])
    .filter(Boolean)
    .map(findForm)
    .find(Boolean);
}

async function submitRegistration(session) {
  const routes = [];
  const messages = [];
  const requests = [];
  const fields = ['Cliente', 'cliente@example.test', 'example-password', 'example-password'];
  const user = { id: 'test-user' };
  const registerForm = {
    registrationSuccessTitle: 'Registration successful',
    registrationSuccessDesc: 'Welcome!',
    confirmEmailTitle: 'Confirm your email address',
    confirmEmailDesc: 'Confirm your email before signing in.',
  };
  const jsx = (type, props) => ({ type, props });
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    react: { useState: (initialValue) => [fields.length ? fields.shift() : initialValue, () => {}] },
    'next/navigation': { useRouter: () => ({ push: (route) => routes.push(route) }) },
    '@/hooks/use-toast': { useToast: () => ({ toast: (message) => messages.push(message) }) },
    '@/context/locale-context': { useLocale: () => ({ translations: { common: {}, loginForm: {}, registerForm } }) },
    '@/lib/supabaseClient': {
      supabase: {
        auth: {
          async signUp(credentials) {
            requests.push(credentials);
            return { data: { user, session }, error: null };
          },
        },
      },
    },
    '@/lib/registrationFlow': registrationFlowExports,
  };
  const exports = {};
  // Run the real submit handler with stubbed JSX, browser hooks and Auth.
  runInNewContext(outputText, {
    exports,
    require: (name) => modules[name] ?? {},
    process: { env: {} },
  }, { filename });

  const form = findForm(exports.RegisterForm());
  await form.props.onSubmit({ preventDefault() {} });
  assert.equal(requests.length, 1);
  return { routes, messages, registerForm };
}

test('registration with a session opens the profile', async () => {
  const { routes, messages, registerForm } = await submitRegistration({ access_token: 'fixture' });
  assert.deepEqual(routes, ['/profile']);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].title, registerForm.registrationSuccessTitle);
});

test('registration without a session requests email confirmation and stays on the form', async () => {
  const { routes, messages, registerForm } = await submitRegistration(null);
  assert.deepEqual(routes, []);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].title, registerForm.confirmEmailTitle);
  assert.equal(messages[0].description, registerForm.confirmEmailDesc);
});
