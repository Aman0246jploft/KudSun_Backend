const translator = require('open-google-translator');

// Language mapping for better compatibility
const LANGUAGE_MAPPING = {
  'english': 'en',
  'thi': 'th', // Thai
  'thai': 'th',
  'en': 'en',
  'th': 'th'
};

/**
 * Translate text to user's preferred language
 * @param {string} text - Text to translate
 * @param {string} userLanguage - User's preferred language
 * @param {string} fromLanguage - Source language (default: 'en')
 * @returns {Promise<string>} - Translated text
 */
async function translateText(text, userLanguage, fromLanguage = 'en') {
  try {
    // Normalize language code
    const normalizedLanguage = LANGUAGE_MAPPING[userLanguage?.toLowerCase()] || 'en';
    
    // If target language is same as source language, return original text
    if (normalizedLanguage === fromLanguage) {
      return text;
    }

    // Use open-google-translator package
    const data = await translator.TranslateLanguageData({
      listOfWordsToTranslate: [text],
      fromLanguage: fromLanguage,
      toLanguage: normalizedLanguage,
    });

    return data[0]?.translation || text; // Fallback to original text if translation fails
  } catch (error) {
    console.error('Translation error:', error.message);
    // Return original text if translation fails
    return text;
  }
}

/**
 * Translate notification content (title and message)
 * @param {Object} notification - Notification object with title and message
 * @param {string} userLanguage - User's preferred language
 * @returns {Promise<Object>} - Notification object with translated content
 */
async function translateNotification(notification, userLanguage) {
  try {
    const { title, message, ...otherFields } = notification;
    
    // Translate title and message in parallel
    const [translatedTitle, translatedMessage] = await Promise.all([
      translateText(title, userLanguage),
      translateText(message, userLanguage)
    ]);

    return {
      ...otherFields,
      title: translatedTitle,
      message: translatedMessage,
      originalTitle: title, // Keep original for reference
      originalMessage: message // Keep original for reference
    };
  } catch (error) {
    console.error('Notification translation error:', error.message);
    // Return original notification if translation fails
    return notification;
  }
}

/**
 * Get user's language preference from database
 * @param {string} userId - User ID
 * @returns {Promise<string>} - User's preferred language
 */
async function getUserLanguage(userId) {
  try {
    const { User } = require('../db');
    const user = await User.findById(userId).select('language');
    return user?.language || 'english'; // Default to English
  } catch (error) {
    console.error('Error fetching user language:', error.message);
    return 'english'; // Default fallback
  }
}

module.exports = {
  translateText,
  translateNotification,
  getUserLanguage,
  LANGUAGE_MAPPING
};
