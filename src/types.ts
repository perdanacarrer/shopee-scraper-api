export interface ShopeeItemResponse {
  bff_meta: any;
  error: string | null;
  error_msg: string | null;
  data: ShopeeItemData;
}

export interface ShopeeItemData {
  item: ShopeeItem;
  account: ShopeeAccount;
  product_images: ProductImages;
  product_price: ProductPrice;
  product_review: ProductReview;
  shop_detailed: ShopDetailed;
  product_attributes: ProductAttributes;
}

export interface ShopeeItem {
  item_id: number;
  shop_id: number;
  item_status: string;
  status: number;
  title: string;
  image: string;
  description: string;
  price: number;
  price_min: number;
  price_max: number;
  models: ShopeeModel[];
  tier_variations: TierVariation[];
  categories: Category[];
  brand: string;
  brand_id: number;
  item_rating: ItemRating;
  ctime: number;
  is_adult: boolean;
  is_preorder: boolean;
  estimated_days: number;
}

export interface ShopeeModel {
  model_id: number;
  name: string;
  price: number;
  price_before_discount: number;
  stock: number | null;
  sold: number | null;
  extinfo: {
    tier_index: number[];
    is_pre_order: boolean;
    estimated_days: number;
  };
}

export interface TierVariation {
  name: string;
  options: string[];
  images: string[] | null;
}

export interface Category {
  catid: number;
  display_name: string;
  no_sub: boolean;
  is_default_subcat: boolean;
}

export interface ItemRating {
  rating_star: number;
}

export interface ShopeeAccount {
  user_id: number | null;
  is_new_user: boolean | null;
  default_address: {
    state: string;
    city: string;
    district: string;
    town: string;
    zip_code: string;
    address: string | null;
    region: string | null;
  };
}

export interface ProductImages {
  images: string[];
  video: any;
  first_tier_variations: any[];
  sorted_variation_image_index_list: number[];
}

export interface ProductPrice {
  price: {
    range_min: number;
    range_max: number;
    single_value: number;
  };
  price_before_discount: any;
  discount: any;
  hide_price: boolean;
  hide_discount: boolean;
}

export interface ProductReview {
  rating_star: number;
  rating_count: number[];
  total_rating_count: number;
  cmt_count: number;
  liked: boolean;
  liked_count: number;
}

export interface ShopDetailed {
  shopid: number;
  userid: number;
  name: string;
  place: string;
  rating_star: number;
  follower_count: number;
  item_count: number;
  response_rate: number;
  response_time: number;
  is_official_shop: boolean;
  is_preferred_plus_seller: boolean;
  is_shopee_verified: boolean;
}

export interface ProductAttributes {
  attrs: ProductAttribute[];
  categories: Category[];
}

export interface ProductAttribute {
  name: string;
  value: string;
  type: number;
  url?: string;
  brand_id?: number;
}

export interface ScrapeRequest {
  storeId: string;
  dealId: string;
}

export interface BatchScrapeRequest {
  items: ScrapeRequest[];
}

export interface ScrapeResponse {
  success: boolean;
  data?: any;
  error?: string;
}