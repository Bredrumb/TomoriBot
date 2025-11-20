/**
 * Response type for Bing Translate API
 */
export interface BingResponse {
	translation: string;
	language: {
		from: string;
		to: string;
	};
}

/**
 * Response type for Google Translate API
 */
export interface GoogleResponse {
	text: string;
	from: {
		language: {
			iso: string;
		};
	};
}
