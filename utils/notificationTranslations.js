// Notification translations utility
// This module provides translation functionality for notifications based on user language preferences

const notificationTranslations = {
  english: {
    // Order notifications
    'Order Confirmed': 'Order Confirmed',
    'Your order #{{orderNumber}} has been confirmed and will be shipped soon!': 'Your order #{{orderNumber}} has been confirmed and will be shipped soon!',
    'Order Status Updated': 'Order Status Updated',
    'Your order status has been updated to {{status}}': 'Your order status has been updated to {{status}}',
    'Order Shipped': 'Order Shipped',
    'Your order has been shipped with tracking number: {{trackingNumber}}': 'Your order has been shipped with tracking number: {{trackingNumber}}',
    'Order Delivered': 'Order Delivered',
    'Your order has been delivered successfully': 'Your order has been delivered successfully',
    'New Order Received!': 'New Order Received!',
    'You have received a new order for {{itemCount}} item(s). Order amount: ฿{{amount}}': 'You have received a new order for {{itemCount}} item(s). Order amount: ฿{{amount}}',
    'Order Completed!': 'Order Completed!',
    'Order Completed - Payment Received!': 'Order Completed - Payment Received!',
    'Order Cancelled': 'Order Cancelled',
    'Your order {{orderNumber}} has been automatically cancelled due to pending payment for more than {{hours}} hours.': 'Your order {{orderNumber}} has been automatically cancelled due to pending payment for more than {{hours}} hours.',
    'Your order {{orderNumber}} has been automatically cancelled due to pending payment.': 'Your order {{orderNumber}} has been automatically cancelled due to pending payment.',
    'Order {{orderNumber}} has been automatically cancelled due to buyer\'s pending payment for more than {{hours}} hours.': 'Order {{orderNumber}} has been automatically cancelled due to buyer\'s pending payment for more than {{hours}} hours.',
    'Order {{orderNumber}} has been automatically cancelled due to pending payment.': 'Order {{orderNumber}} has been automatically cancelled due to pending payment.',
    
    // Product notifications
    'Your Product Has Been Deactivated': 'Your Product Has Been Deactivated',
    'An admin has deactivated your product "{{productTitle}}".': 'An admin has deactivated your product "{{productTitle}}".',
    'Your Product Has Been Activated': 'Your Product Has Been Activated',
    'An admin has activated your product "{{productTitle}}".': 'An admin has activated your product "{{productTitle}}".',
    'Someone liked your product!': 'Someone liked your product!',
    'Your {{productName}} listing received a new like.': 'Your {{productName}} listing received a new like.',
    
    // Chat notifications
    'New Message': 'New Message',
    'You have received a new message from a buyer interested in your product.': 'You have received a new message from a buyer interested in your product.',
    'Deal Discussion': 'Deal Discussion',
    'Someone is interested in negotiating the price for your item.': 'Someone is interested in negotiating the price for your item.',
    
    // Review notifications
    'reviewed your Item': 'reviewed your Item',
    '{{rating}}-star review: "{{reviewText}}"': '{{rating}}-star review: "{{reviewText}}"',
    
    // System notifications
    'System Maintenance': 'System Maintenance',
    'Scheduled maintenance will occur tonight from 2:00 AM to 4:00 AM.': 'Scheduled maintenance will occur tonight from 2:00 AM to 4:00 AM.',
    'Welcome!': 'Welcome!',
    'Thanks for joining our community. Start exploring amazing products!': 'Thanks for joining our community. Start exploring amazing products!',
    
    // Alert notifications
    'Price Alert': 'Price Alert',
    'The {{productName}} you\'re watching has dropped in price!': 'The {{productName}} you\'re watching has dropped in price!',
    
    // Activity notifications
    'liked your product': 'liked your product',
    'commented on your product': 'commented on your product',
    'started following you': 'started following you',
    'placed a bid on your product': 'placed a bid on your product',
    'New bid on Your Product': 'New bid on Your Product',
    '{{userName}} bid on your auction "{{productTitle}}"': '{{userName}} bid on your auction "{{productTitle}}"',
    'New Comment on Your Thread': 'New Comment on Your Thread',
    'Products Associated with Your Thread': 'Products Associated with Your Thread',
    '{{userName}} associated {{count}} product(s) with your thread: {{products}}': '{{userName}} associated {{count}} product(s) with your thread: {{products}}',
    
    // Dispute notifications
    'Dispute Raised Against Your Order': 'Dispute Raised Against Your Order',
    'A buyer has raised a dispute for order {{orderNumber}}. Reason: {{reason}}': 'A buyer has raised a dispute for order {{orderNumber}}. Reason: {{reason}}',
    
    // Generic messages
    'No comment': 'No comment',
    'User': 'User'
  },
  
  thi: {
    // Order notifications
    'Order Confirmed': 'คำสั่งซื้อได้รับการยืนยัน',
    'Your order #{{orderNumber}} has been confirmed and will be shipped soon!': 'คำสั่งซื้อ #{{orderNumber}} ของคุณได้รับการยืนยันแล้วและจะจัดส่งเร็วๆ นี้!',
    'Order Status Updated': 'สถานะคำสั่งซื้อได้รับการอัปเดต',
    'Your order status has been updated to {{status}}': 'สถานะคำสั่งซื้อของคุณได้รับการอัปเดตเป็น {{status}}',
    'Order Shipped': 'จัดส่งคำสั่งซื้อแล้ว',
    'Your order has been shipped with tracking number: {{trackingNumber}}': 'คำสั่งซื้อของคุณได้จัดส่งแล้วด้วยหมายเลขติดตาม: {{trackingNumber}}',
    'Order Delivered': 'จัดส่งสำเร็จ',
    'Your order has been delivered successfully': 'คำสั่งซื้อของคุณได้จัดส่งสำเร็จแล้ว',
    'New Order Received!': 'ได้รับคำสั่งซื้อใหม่!',
    'You have received a new order for {{itemCount}} item(s). Order amount: ฿{{amount}}': 'คุณได้รับคำสั่งซื้อใหม่สำหรับ {{itemCount}} รายการ จำนวนเงิน: ฿{{amount}}',
    'Order Completed!': 'คำสั่งซื้อเสร็จสิ้น!',
    'Order Completed - Payment Received!': 'คำสั่งซื้อเสร็จสิ้น - ได้รับการชำระเงินแล้ว!',
    'Order Cancelled': 'ยกเลิกคำสั่งซื้อ',
    'Your order {{orderNumber}} has been automatically cancelled due to pending payment for more than {{hours}} hours.': 'คำสั่งซื้อ {{orderNumber}} ของคุณถูกยกเลิกโดยอัตโนมัติเนื่องจากการชำระเงินค้างชำระมากกว่า {{hours}} ชั่วโมง',
    'Your order {{orderNumber}} has been automatically cancelled due to pending payment.': 'คำสั่งซื้อ {{orderNumber}} ของคุณถูกยกเลิกโดยอัตโนมัติเนื่องจากการชำระเงินค้างชำระ',
    'Order {{orderNumber}} has been automatically cancelled due to buyer\'s pending payment for more than {{hours}} hours.': 'คำสั่งซื้อ {{orderNumber}} ถูกยกเลิกโดยอัตโนมัติเนื่องจากผู้ซื้อค้างชำระเงินมากกว่า {{hours}} ชั่วโมง',
    'Order {{orderNumber}} has been automatically cancelled due to pending payment.': 'คำสั่งซื้อ {{orderNumber}} ถูกยกเลิกโดยอัตโนมัติเนื่องจากการชำระเงินค้างชำระ',
    
    // Product notifications
    'Your Product Has Been Deactivated': 'สินค้าของคุณถูกปิดใช้งาน',
    'An admin has deactivated your product "{{productTitle}}".': 'ผู้ดูแลระบบได้ปิดใช้งานสินค้า "{{productTitle}}" ของคุณ',
    'Your Product Has Been Activated': 'สินค้าของคุณถูกเปิดใช้งาน',
    'An admin has activated your product "{{productTitle}}".': 'ผู้ดูแลระบบได้เปิดใช้งานสินค้า "{{productTitle}}" ของคุณ',
    'Someone liked your product!': 'มีคนชอบสินค้าของคุณ!',
    'Your {{productName}} listing received a new like.': 'รายการ {{productName}} ของคุณได้รับการถูกใจใหม่',
    
    // Chat notifications
    'New Message': 'ข้อความใหม่',
    'You have received a new message from a buyer interested in your product.': 'คุณได้รับข้อความใหม่จากผู้ซื้อที่สนใจสินค้าของคุณ',
    'Deal Discussion': 'การเจรจาต่อรอง',
    'Someone is interested in negotiating the price for your item.': 'มีคนสนใจที่จะเจรจาราคาสินค้าของคุณ',
    
    // Review notifications
    'reviewed your Item': 'รีวิวสินค้าของคุณ',
    '{{rating}}-star review: "{{reviewText}}"': 'รีวิว {{rating}} ดาว: "{{reviewText}}"',
    
    // System notifications
    'System Maintenance': 'การบำรุงรักษาระบบ',
    'Scheduled maintenance will occur tonight from 2:00 AM to 4:00 AM.': 'การบำรุงรักษาตามกำหนดจะดำเนินการคืนนี้ตั้งแต่ 02:00 น. ถึง 04:00 น.',
    'Welcome!': 'ยินดีต้อนรับ!',
    'Thanks for joining our community. Start exploring amazing products!': 'ขอบคุณที่เข้าร่วมชุมชนของเรา เริ่มสำรวจสินค้าที่น่าทึ่งกันเลย!',
    
    // Alert notifications
    'Price Alert': 'แจ้งเตือนราคา',
    'The {{productName}} you\'re watching has dropped in price!': '{{productName}} ที่คุณกำลังติดตามมีราคาลดลง!',
    
    // Activity notifications
    'liked your product': 'ถูกใจสินค้าของคุณ',
    'commented on your product': 'แสดงความคิดเห็นในสินค้าของคุณ',
    'started following you': 'เริ่มติดตามคุณ',
    'placed a bid on your product': 'วางประมูลสินค้าของคุณ',
    'New bid on Your Product': 'มีการประมูลใหม่ในสินค้าของคุณ',
    '{{userName}} bid on your auction "{{productTitle}}"': '{{userName}} ประมูลในการประมูล "{{productTitle}}" ของคุณ',
    'New Comment on Your Thread': 'ความคิดเห็นใหม่ในเธรดของคุณ',
    'Products Associated with Your Thread': 'สินค้าที่เชื่อมโยงกับเธรดของคุณ',
    '{{userName}} associated {{count}} product(s) with your thread: {{products}}': '{{userName}} เชื่อมโยง {{count}} สินค้ากับเธรดของคุณ: {{products}}',
    
    // Dispute notifications
    'Dispute Raised Against Your Order': 'มีการร้องเรียนต่อคำสั่งซื้อของคุณ',
    'A buyer has raised a dispute for order {{orderNumber}}. Reason: {{reason}}': 'ผู้ซื้อได้ร้องเรียนสำหรับคำสั่งซื้อ {{orderNumber}} เหตุผล: {{reason}}',
    
    // Generic messages
    'No comment': 'ไม่มีความคิดเห็น',
    'User': 'ผู้ใช้'
  }
};

/**
 * Translates notification text based on user language
 * @param {string} text - Text to translate
 * @param {string} language - Target language ('english' or 'thi')
 * @param {object} variables - Variables to replace in the text (e.g., {orderNumber: '12345'})
 * @returns {string} Translated text
 */
const translateNotification = (text, language = 'english', variables = {}) => {
  // Default to English if language not supported
  const targetLanguage = language === 'thi' ? 'thi' : 'english';
  
  // Get translation
  let translatedText = notificationTranslations[targetLanguage][text] || text;
  
  // Replace variables in the format {{variableName}}
  if (variables && Object.keys(variables).length > 0) {
    Object.keys(variables).forEach(key => {
      const placeholder = `{{${key}}}`;
      const value = variables[key] || '';
      translatedText = translatedText.replace(new RegExp(placeholder, 'g'), value);
    });
  }
  
  return translatedText;
};

/**
 * Extracts variables from notification text for translation
 * @param {string} text - Original notification text
 * @param {object} meta - Notification metadata containing variable values
 * @returns {object} Variables object for translation
 */
const extractNotificationVariables = (text, meta = {}) => {
  const variables = {};
  
  // Common variable mappings
  if (meta.orderNumber) variables.orderNumber = meta.orderNumber;
  if (meta.trackingNumber) variables.trackingNumber = meta.trackingNumber;
  if (meta.status) variables.status = meta.status;
  if (meta.productTitle) variables.productTitle = meta.productTitle;
  if (meta.productName) variables.productName = meta.productName;
  if (meta.rating) variables.rating = meta.rating;
  if (meta.reviewText) variables.reviewText = meta.reviewText;
  if (meta.userName) variables.userName = meta.userName;
  if (meta.itemCount) variables.itemCount = meta.itemCount;
  if (meta.amount) variables.amount = meta.amount;
  if (meta.totalAmount) variables.totalAmount = meta.totalAmount;
  if (meta.hours) variables.hours = meta.hours;
  if (meta.count) variables.count = meta.count;
  if (meta.products) variables.products = meta.products;
  if (meta.reason) variables.reason = meta.reason;
  
  return variables;
};

/**
 * Get supported languages
 * @returns {array} Array of supported language codes
 */
const getSupportedLanguages = () => {
  return Object.keys(notificationTranslations);
};

/**
 * Check if a language is supported
 * @param {string} language - Language code to check
 * @returns {boolean} True if language is supported
 */
const isLanguageSupported = (language) => {
  return getSupportedLanguages().includes(language);
};

module.exports = {
  translateNotification,
  extractNotificationVariables,
  getSupportedLanguages,
  isLanguageSupported,
  notificationTranslations
};
