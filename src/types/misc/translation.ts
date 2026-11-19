export interface BingResponse {
  translation: string;
  language: {
    from: string;
    to: string;
  };
}

export interface GoogleResponse {
  text: string;
  from: {
    language: {
      iso: string;
    };
  };
}
