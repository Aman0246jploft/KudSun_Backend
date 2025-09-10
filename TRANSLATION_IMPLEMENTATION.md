# Language-Specific Notifications Implementation

## Overview
This implementation adds automatic translation support to the notification system, allowing notifications to be sent in the user's preferred language based on their language preference stored in the User model.

## Features
- ✅ Automatic translation of notification titles and messages
- ✅ Support for multiple languages (English, Thai, and more)
- ✅ Fallback to original text if translation fails
- ✅ Preserves original content for reference
- ✅ Works with all existing notification functions
- ✅ Uses existing `translate` package (no additional dependencies needed)

## How It Works

### 1. User Language Preference
The User model already includes a `language` field:
```javascript
language: {
  type: String,
  default: "english",
}
```

### 2. Translation Utility (`utils/translation.js`)
- `translateText()` - Translates individual text strings
- `translateNotification()` - Translates entire notification objects
- `getUserLanguage()` - Fetches user's language preference from database

### 3. Updated Notification Functions
All notification functions now automatically translate content:
- `notificationProcessor()` - Queue-based notifications
- `notifyUserOnEvent()` - Session-based notifications
- `notifyUserOnEventNonSession()` - Non-session notifications

## Supported Languages
The system supports these language mappings:
- `english` / `en` → English
- `thi` / `thai` / `th` → Thai

## Usage Examples

### Sending a Notification (Automatic Translation)
```javascript
const { saveNotification } = require('./routes/services/serviceNotification');

// This will automatically translate based on user's language preference
await saveNotification([{
  recipientId: "user-id-here",
  title: "New Order",
  message: "Your order has been confirmed",
  type: "order"
}]);
```

### Manual Translation
```javascript
const { translateNotification, getUserLanguage } = require('./utils/translation');

// Get user's language preference
const userLanguage = await getUserLanguage(userId);

// Translate notification
const translatedNotification = await translateNotification({
  title: "Welcome!",
  message: "Thank you for joining us"
}, userLanguage);

console.log(translatedNotification.title); // Translated title
console.log(translatedNotification.originalTitle); // Original title
```

## Database Changes
Notifications now store additional metadata:
```javascript
{
  // ... existing fields
  meta: {
    userLanguage: "thi",
    originalTitle: "New Order",
    originalMessage: "Your order has been confirmed"
  }
}
```

## Configuration

### Environment Variables (Optional)
Add to `.env` for better translation performance:
```env
GOOGLE_TRANSLATE_API_KEY=your_google_translate_api_key
```

### Adding New Languages
To support additional languages, update the `LANGUAGE_MAPPING` in `utils/translation.js`:
```javascript
const LANGUAGE_MAPPING = {
  'english': 'en',
  'thi': 'th',
  'spanish': 'es',  // Add new languages here
  'french': 'fr',
  // ... more languages
};
```

## Testing
Run the test script to verify translation functionality:
```bash
node test-translation.js
```

## Error Handling
- If translation fails, the system falls back to the original text
- All errors are logged but don't break the notification flow
- Translation errors are handled gracefully

## Performance Considerations
- Translations are performed asynchronously
- Failed translations don't block notification delivery
- Consider caching translations for frequently used messages
- For high-volume applications, consider using official Google Translate API

## Migration Notes
- No database migration required
- Existing notifications continue to work
- New notifications will automatically include translation metadata
- Backward compatible with existing notification code

## Alternative: Using open-google-translator Package
If you prefer to use the `open-google-translator` package instead of the existing `translate` package, you can modify `utils/translation.js`:

```javascript
// Install: npm install open-google-translator
const translator = require("open-google-translator");

async function translateText(text, userLanguage, fromLanguage = 'en') {
  try {
    const normalizedLanguage = LANGUAGE_MAPPING[userLanguage?.toLowerCase()] || 'en';
    
    if (normalizedLanguage === fromLanguage) {
      return text;
    }

    const data = await translator.TranslateLanguageData({
      listOfWordsToTranslate: [text],
      fromLanguage: fromLanguage,
      toLanguage: normalizedLanguage,
    });

    return data[0]?.translation || text;
  } catch (error) {
    console.error('Translation error:', error.message);
    return text;
  }
}
```

## Troubleshooting
1. **Translation not working**: Check if the `translate` package is properly installed
2. **Rate limiting**: Consider adding API key for Google Translate
3. **Language not supported**: Add language mapping to `LANGUAGE_MAPPING`
4. **Performance issues**: Consider caching or using official API

## Future Enhancements
- [ ] Add caching for translated content
- [ ] Support for more languages
- [ ] Batch translation for multiple notifications
- [ ] Translation quality metrics
- [ ] Admin interface for managing translations
