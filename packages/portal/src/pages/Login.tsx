import { SignIn } from '@clerk/clerk-react';

export default function Login() {
  return (
    <div className="login-page">
      <div className="login-container">
        <h1 className="login-title">Music MCP</h1>
        <p className="login-subtitle">Sign in to manage your Apple Music integration</p>
        <SignIn routing="hash" />
      </div>
    </div>
  );
}
