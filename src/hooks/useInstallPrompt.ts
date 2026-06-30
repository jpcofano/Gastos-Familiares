import { useEffect, useState, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function yaInstalada(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as any).standalone === true; // iOS Safari
}

export function useInstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [instalada, setInstalada] = useState(yaInstalada());
  const [descartado, setDescartado] = useState(
    () => sessionStorage.getItem('gf-install-banner-descartado') === '1'
  );

  useEffect(() => {
    if (instalada) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalada(true);
      setDeferredEvent(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [instalada]);

  const instalar = useCallback(async () => {
    if (!deferredEvent) return;
    await deferredEvent.prompt();
    const { outcome } = await deferredEvent.userChoice;
    setDeferredEvent(null);
    if (outcome === 'accepted') setInstalada(true);
  }, [deferredEvent]);

  const descartar = useCallback(() => {
    setDescartado(true);
    sessionStorage.setItem('gf-install-banner-descartado', '1');
  }, []);

  const mostrarBanner = Boolean(deferredEvent) && !instalada && !descartado;

  return { mostrarBanner, instalar, descartar };
}
