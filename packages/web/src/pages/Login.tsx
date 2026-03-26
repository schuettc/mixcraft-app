import { SignIn, SignUp } from '@clerk/clerk-react';

export function Login() {
  return (
    <div className="login-page">
      <div className="login-container">
        <h1 className="login-title">MixCraft</h1>
        <p className="login-subtitle">Sign in to manage your music integrations</p>
        <SignIn
          signUpUrl="/sign-up"
          fallbackRedirectUrl="/"
        />
      </div>
    </div>
  );
}

export function Register() {
  return (
    <div className="login-page">
      <div className="login-container">
        <h1 className="login-title">MixCraft</h1>
        <p className="login-subtitle">Create your account to get started</p>
        <SignUp
          signInUrl="/"
          fallbackRedirectUrl="/"
        />
      </div>
    </div>
  );
}
