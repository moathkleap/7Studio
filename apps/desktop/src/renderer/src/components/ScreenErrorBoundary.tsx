import { Component, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/Button';

function ScreenErrorFallback({ onRetry }: { onRetry: () => void }): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="grid h-full place-items-center p-8 text-center" data-testid="screen-error">
      <div>
        <h2 className="text-base font-semibold">{t('app.screenError')}</h2>
        <p className="mt-2 max-w-md text-sm text-muted">{t('app.screenErrorBody')}</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button action="app.screenRetry" variant="primary" onClick={onRetry}>{t('common.retry')}</Button>
          <Button action="app.reloadFromError" variant="outline" onClick={() => window.location.reload()}>{t('app.reload')}</Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Catches render errors from the lazily-loaded screen (including a failed dynamic import of its chunk) so a
 * single broken screen shows a retry/reload inside the app shell instead of tearing down the whole window.
 * Retry re-attempts the render (recovers transient errors); Reload recovers a stale/corrupt chunk, which
 * React.lazy caches and would otherwise keep re-throwing.
 */
export class ScreenErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  override state = { error: false };

  override componentDidCatch(error: unknown): void {
    console.error('screen render failed', error);
    this.setState({ error: true });
  }

  override render(): ReactNode {
    if (this.state.error) return <ScreenErrorFallback onRetry={() => this.setState({ error: false })} />;
    return this.props.children;
  }
}
