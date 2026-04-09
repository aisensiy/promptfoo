import Navigation from '@app/components/Navigation';
import { PostHogProvider } from '@app/components/PostHogProvider';
import UpdateBanner from '@app/components/UpdateBanner';
import { useThemePreference } from '@app/hooks/useThemePreference';
import { Outlet } from 'react-router-dom';
import { PostHogPageViewTracker } from './PostHogPageViewTracker';

function Layout({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

export default function PageShell() {
  const theme = useThemePreference();

  return (
    <PostHogProvider>
      <Layout>
        <Navigation
          resolvedTheme={theme.resolvedTheme}
          systemTheme={theme.systemTheme}
          themePreference={theme.themePreference}
          onThemePreferenceChange={theme.setThemePreference}
        />
        <UpdateBanner />
        <Outlet />
        <PostHogPageViewTracker />
      </Layout>
    </PostHogProvider>
  );
}
