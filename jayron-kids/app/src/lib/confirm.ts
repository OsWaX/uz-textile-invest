/**
 * Подтверждение действия («Отменить заказ?») в собственном окне приложения —
 * одинаково на телефоне и в браузере. Окно рисует ConfirmHost в корневом макете.
 */
export type ConfirmRequest = { title: string; yes: string; no: string; resolve: (answer: boolean) => void };

let show: ((request: ConfirmRequest) => void) | null = null;

export function registerConfirmHost(handler: (request: ConfirmRequest) => void) {
  show = handler;
  return () => {
    if (show === handler) show = null;
  };
}

export function confirmAsync(title: string, yes: string, no: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) {
      resolve(false);
      return;
    }
    show({ title, yes, no, resolve });
  });
}
