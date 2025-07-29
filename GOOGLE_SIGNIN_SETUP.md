# Google Sign-In API Setup Guide

## Backend Setup

### 1. Environment Variables
Add the following environment variable to your `.env` file:

```env
GOOGLE_CLIENT_ID=your_google_client_id_here
```

### 2. API Endpoint
The Google Sign-In API is now available at:
```
POST /api/user/googleSignIn
```

### 3. Request Format
```json
{
  "idToken": "google_id_token_from_flutter",
  "fcmToken": "firebase_fcm_token_optional"
}
```

### 4. Response Format
Success Response (200):
```json
{
  "status": true,
  "message": "Google sign-in successful",
  "data": {
    "token": "jwt_token",
    "userId": "user_id",
    "email": "user@example.com",
    "userName": "username",
    "profileImage": "profile_image_url",
    "totalFollowers": 0,
    "totalFollowing": 0,
    // ... other user fields
  }
}
```

Error Response (400/401/500):
```json
{
  "status": false,
  "message": "Error message",
  "data": null
}
```

## Flutter Integration

### 1. Dependencies
Add to your `pubspec.yaml`:
```yaml
dependencies:
  google_sign_in: ^6.1.5
  http: ^1.1.0
```

### 2. Flutter Implementation Example

```dart
import 'package:google_sign_in/google_sign_in.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

class GoogleSignInService {
  static final GoogleSignIn _googleSignIn = GoogleSignIn(
    scopes: ['email', 'profile'],
  );

  static Future<Map<String, dynamic>?> signInWithGoogle() async {
    try {
      // Trigger Google Sign-In flow
      final GoogleSignInAccount? googleUser = await _googleSignIn.signIn();
      
      if (googleUser == null) {
        // User cancelled the sign-in
        return null;
      }

      // Get authentication details
      final GoogleSignInAuthentication googleAuth = 
          await googleUser.authentication;

      // Send to your backend
      final response = await http.post(
        Uri.parse('YOUR_API_BASE_URL/api/user/googleSignIn'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'idToken': googleAuth.idToken,
          'fcmToken': 'your_fcm_token_here', // Optional
        }),
      );

      final responseData = jsonDecode(response.body);
      
      if (response.statusCode == 200 && responseData['status'] == true) {
        return responseData['data'];
      } else {
        throw Exception(responseData['message'] ?? 'Sign-in failed');
      }
    } catch (error) {
      print('Google Sign-In Error: $error');
      return null;
    }
  }

  static Future<void> signOut() async {
    await _googleSignIn.signOut();
  }
}
```

### 3. Usage in Flutter Widget

```dart
class LoginScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ElevatedButton(
          onPressed: () async {
            final userData = await GoogleSignInService.signInWithGoogle();
            if (userData != null) {
              // Save JWT token and navigate to main app
              String jwtToken = userData['token'];
              // Store token in secure storage and navigate
              Navigator.pushReplacementNamed(context, '/home');
            } else {
              // Handle sign-in failure
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('Google Sign-In failed')),
              );
            }
          },
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.login),
              SizedBox(width: 8),
              Text('Sign in with Google'),
            ],
          ),
        ),
      ),
    );
  }
}
```

## Google Console Setup

### 1. Create Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google+ API

### 2. Create OAuth 2.0 Credentials
1. Go to APIs & Services > Credentials
2. Click "Create Credentials" > "OAuth 2.0 Client IDs"
3. Create credentials for:
   - **Web application** (for your backend)
   - **Android** (for your Flutter Android app)
   - **iOS** (for your Flutter iOS app)

### 3. Configure OAuth Consent Screen
1. Go to APIs & Services > OAuth consent screen
2. Configure app information
3. Add test users during development

### 4. Get Client IDs
- Use the **Web application** client ID for your backend `GOOGLE_CLIENT_ID`
- Use **Android/iOS** client IDs in your Flutter app configuration

## Security Notes

1. **Never expose server credentials** in your Flutter app
2. **Validate tokens** on the backend before trusting user data
3. **Use HTTPS** for all API communications
4. **Store JWT tokens securely** in Flutter (use flutter_secure_storage)
5. **Implement token refresh** if using long-lived sessions

## API Features

The Google Sign-In API handles:
- ✅ New user registration with Google account
- ✅ Existing user login
- ✅ Profile image from Google account
- ✅ Automatic username generation
- ✅ FCM token update
- ✅ Follower/following counts
- ✅ Algolia search indexing
- ✅ JWT token generation
- ✅ Account validation (disabled/deleted checks)

## Error Handling

Common error scenarios:
- Invalid Google token
- Account disabled/deleted
- Network connectivity issues
- Server errors

Make sure to handle these gracefully in your Flutter app. 