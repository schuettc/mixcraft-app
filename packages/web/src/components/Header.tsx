import { useUser, useClerk } from '@clerk/clerk-react';

export default function Header() {
  const { user } = useUser();
  const { signOut } = useClerk();

  return (
    <header className="app-header">
      <h1>MixCraft</h1>
      <div className="header-right">
        <span className="user-email">{user?.primaryEmailAddress?.emailAddress}</span>
        <button className="btn btn-secondary" onClick={() => signOut()}>
          Sign Out
        </button>
      </div>
    </header>
  );
}
