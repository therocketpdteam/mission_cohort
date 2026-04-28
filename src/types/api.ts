export type ApiSuccess<T> = {
  success: true;
  data: T;
};

export type ApiFailure = {
  success: false;
  error: {
    message: string;
    code: string;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
