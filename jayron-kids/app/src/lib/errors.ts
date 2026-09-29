/** Ошибка API: машинный код (для перевода на язык интерфейса), HTTP-статус и подробности. */
export class ApiError extends Error {
  code: string;
  status: number;
  details: Record<string, any> | undefined;

  constructor(code: string, status: number, details?: Record<string, any>) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
