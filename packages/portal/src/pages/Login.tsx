import { SignIn } from '@clerk/clerk-react';

export default function Login() {
  return (
    <div className="login-page">
      <div className="login-container">
        <h1 className="login-title">Mixcraft</h1>
        <p className="login-subtitle">Sign in to manage your music integrations</p>
        <SignIn routing="hash" />
      </div>
    </div>
  );
}
