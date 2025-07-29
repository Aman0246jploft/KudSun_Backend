# Google Sign-In API Testing

## Quick Test with cURL

```bash
curl -X POST http://localhost:3000/api/user/googleSignIn \
  -H "Content-Type: application/json" \
  -d '{
    "idToken": "your_google_id_token_here",
    "fcmToken": "optional_fcm_token"
  }'
```

## Expected Response

```json
{
  "status": true,
  "message": "Google sign-in successful",
  "data": {
    "token": "jwt_token_here",
    "email": "user@gmail.com",
    "userName": "generated_username",
    "profileImage": "google_profile_image_url",
    "totalFollowers": 0,
    "totalFollowing": 0
  }
}
```

## Test Scenarios

1. **New User**: Creates account with Google data
2. **Existing User**: Updates login and FCM token
3. **Invalid Token**: Returns 401 error
4. **Missing Token**: Returns 400 validation error 