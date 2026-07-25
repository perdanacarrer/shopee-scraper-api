import * as cheerio from 'cheerio';

export function parseProductData(html: string, dealId: string, storeId: string): any {
  try {
    const $ = cheerio.load(html);
    
    const productData: any = {
      item_id: parseInt(dealId),
      shop_id: parseInt(storeId),
      title: '',
      price: 0,
      description: '',
      images: [],
      rating: { rating_star: 5, rating_count: 0 },
      status: 'normal',
      brand: '',
      shop_name: ''
    };

    // Extract title
    const ogTitle = $('meta[property="og:title"]').attr('content');
    if (ogTitle) {
      productData.title = ogTitle;
      console.log(`[PARSER] Found title from og:title`);
    }

    if (!productData.title) {
      const h1Title = $('h1').first().text().trim();
      if (h1Title) {
        productData.title = h1Title;
        console.log(`[PARSER] Found title from h1`);
      }
    }

    // Extract from JSON-LD
    const scripts = $('script[type="application/ld+json"]');
    scripts.each((i, elem) => {
      try {
        const scriptData = JSON.parse($(elem).html() || '{}');
        if (scriptData.name) {
          productData.title = scriptData.name;
        }
        if (scriptData.offers && scriptData.offers.price) {
          productData.price = parseFloat(scriptData.offers.price) * 100;
        }
        if (scriptData.aggregateRating) {
          productData.rating = {
            rating_star: scriptData.aggregateRating.ratingValue || 5,
            rating_count: scriptData.aggregateRating.reviewCount || 0
          };
        }
        if (scriptData.image) {
          if (Array.isArray(scriptData.image)) {
            productData.images = scriptData.image;
          } else {
            productData.images = [scriptData.image];
          }
        }
      } catch (e) {
        // Skip invalid JSON
      }
    });

    // Extract price
    const metaPrice = $('meta[itemprop="price"]').attr('content');
    if (metaPrice) {
      productData.price = parseFloat(metaPrice) * 100;
      console.log(`[PARSER] Found price from meta: ${metaPrice}`);
    }

    if (!productData.price) {
      const priceText = $('[class*="price"]').first().text();
      const priceMatch = priceText.match(/[\d,]+/);
      if (priceMatch) {
        productData.price = parseInt(priceMatch[0].replace(/,/g, '')) * 100;
        console.log(`[PARSER] Found price from price element`);
      }
    }

    // Extract description
    const ogDescription = $('meta[property="og:description"]').attr('content');
    if (ogDescription) {
      productData.description = ogDescription;
      console.log(`[PARSER] Found description`);
    }

    // Extract image
    if (productData.images.length === 0) {
      const ogImage = $('meta[property="og:image"]').attr('content');
      if (ogImage) {
        productData.images = [ogImage];
        console.log(`[PARSER] Found image from og:image`);
      }
    }

    // Extract brand and shop
    const brand = $('meta[itemprop="brand"]').attr('content') || 
                  $('[class*="brand"]').first().text().trim();
    if (brand) {
      productData.brand = brand;
    }

    const shopName = $('meta[itemprop="seller"]').attr('content') ||
                     $('[class*="shop"]').first().text().trim();
    if (shopName) {
      productData.shop_name = shopName;
    }

    console.log(`[PARSER] ✓ Successfully parsed product data`);
    return productData;
  } catch (error) {
    console.error(`[PARSER] Error:`, error);
    return null;
  }
}