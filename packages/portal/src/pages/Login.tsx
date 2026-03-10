import { SignIn, SignUp } from '@clerk/clerk-react';

export function Login() {
  return (
    <div className="login-page">
      <div className="login-container">
        <h1 className="login-title">Mixcraft</h1>
        <p className="login-subtitle">Sign in to manage your music integrations</p>
        <SignIn routing="hash" signUpUrl="/sign-up" />
      </div>
    </div>
  );
}

export function Register() {
  return (
    <div className="login-page">
      <div className="login-container">
        <h1 className="login-title">Mixcraft</h1>
        <p className="login-subtitle">Create your account to get started</p>
        <SignUp routing="hash" signInUrl="/" />
      </div>
    </div>
  );
}
