interface BaseEnhancedContent {
  type: string;
  enhancedContext: boolean;
}

export interface EnhancedVideoContent extends BaseEnhancedContent {
  type: "video";
  uri: string;
  mimeType: string;
  isYouTubeLink: boolean;
}

export interface EnhancedImageContent extends BaseEnhancedContent {
  type: "image";
  uri: string;
  mimeType: string;
  inlineData: {
    mimeType: string;
    data: string;
  };
  isProfilePicture: boolean;
  isProfileBanner?: boolean;
}
