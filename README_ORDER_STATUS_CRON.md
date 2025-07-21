# Enhanced Order Status Update Cron Job & Admin Transactions

This document describes the enhanced order status update cron job and admin transactions management system with comprehensive dispute handling.

## 🚀 Features

### Enhanced Cron Job (`orderStatusUpdateCron.js`)

- **Robust Error Handling**: Comprehensive error handling with detailed logging
- **Dispute Integration**: Proper handling of order disputes during status updates
- **Enhanced Validation**: System state validation before processing
- **Performance Monitoring**: Built-in statistics and performance tracking
- **Health Checks**: Health check endpoints for monitoring
- **Manual Triggers**: API endpoints for manual cron job execution
- **Email Notifications**: Optional admin email notifications (configurable)
- **Safety Features**: Prevents duplicate payments and handles edge cases

### Enhanced Admin Transactions UI (`AdminTransactions.jsx`)

- **Dispute Visualization**: Shows dispute status and information in transaction list
- **Advanced Filtering**: Filter by dispute status, seller payment status, amounts, dates
- **Enhanced Modals**: Detailed payout calculations with dispute information
- **Dispute Details**: Full dispute information modal with history
- **Payment Validation**: Better validation and confirmation for seller payments
- **Responsive Design**: Modern, responsive UI with better UX

### Enhanced API (`getAllTransactionsForAdmin`)

- **Dispute Data**: Includes dispute information in transaction responses
- **Advanced Filtering**: Supports filtering by dispute existence and status
- **Better Pagination**: Improved pagination with filter-aware counts
- **Comprehensive Data**: Includes all necessary transaction and dispute details

## 📋 Order Processing Flow

### 1. SHIPPED → DELIVERED (After N days)
```
1. Find orders with status "SHIPPED" and payment "COMPLETED"
2. Check shipping history to get shipped date
3. Validate no active disputes exist
4. If N days passed since shipped → Update to "DELIVERED"
5. Create status history entry
6. Send notification to buyer
```

### 2. DELIVERED → COMPLETED (After N days)
```
1. Find orders with status "DELIVERED" and payment "COMPLETED"
2. Check delivery history to get delivered date
3. Validate dispute status:
   - Skip if active dispute (PENDING/UNDER_REVIEW)
   - Process if no dispute or resolved dispute
   - Validate admin review for resolved disputes
4. If N days passed → Update to "COMPLETED"
5. Process seller payment with dispute adjustments
6. Create status history entry
7. Send notifications to buyer and seller
```

## 🔧 Configuration

### Environment Variables

```bash
# Basic Configuration
DAY=3                                    # Days to wait before status updates
CRON_SCHEDULE=0 0 * * *                 # Cron schedule (daily at midnight)
DB_STRING=mongodb://localhost:27017/db  # MongoDB connection string

# Email Notifications (Optional)
ENABLE_EMAIL_NOTIFICATIONS=false
ADMIN_EMAIL=admin@example.com
FROM_EMAIL=noreply@example.com

# Safety & Performance (Optional)
MAX_ORDERS_PER_RUN=1000
MIN_ORDER_AGE_HOURS=1
MIN_ORDER_AMOUNT=0

# Logging (Optional)
LOG_LEVEL=info
LOG_TO_FILE=false
LOG_FILE_PATH=./logs/cron.log

# Monitoring (Optional)
ENABLE_CRON_METRICS=false
METRICS_ENDPOINT=/metrics/cron
```

### Configuration File

The cron job uses `config/cronConfig.js` for centralized configuration management with proper defaults and documentation.

## 🧪 Testing

### Manual Test Script

```bash
# Dry run (no actual changes)
node scripts/testOrderStatusCron.js --dry-run --verbose

# Test with specific parameters
node scripts/testOrderStatusCron.js --days=1 --limit=10

# Full test run
node scripts/testOrderStatusCron.js --verbose
```

### Test Options
- `--dry-run`: Run without making actual changes
- `--days=N`: Override the processing day limit
- `--limit=N`: Limit number of orders to process
- `--verbose`: Enable detailed logging
- `--skip-validation`: Skip system validation checks

## 🔍 Monitoring & Health Checks

### Health Check Endpoint
```
GET /cron/health/order-status-update
```

Response:
```json
{
  "status": "running",
  "schedule": "0 0 * * *",
  "processingDayLimit": 3,
  "stats": {
    "lastRun": "2023-12-01T00:00:00.000Z",
    "totalRuns": 150,
    "successfulRuns": 148,
    "failedRuns": 2,
    "ordersProcessed": 1250,
    "paymentsProcessed": 890,
    "disputesHandled": 45
  },
  "uptime": 86400
}
```

### Manual Trigger Endpoint
```
POST /cron/trigger/order-status-update
```

## 🔄 Dispute Handling

### Dispute States
- **PENDING**: New dispute, not yet reviewed
- **UNDER_REVIEW**: Admin is reviewing the dispute
- **RESOLVED**: Admin has made a decision
- **CANCELLED**: Dispute was cancelled

### Order Status Logic with Disputes

1. **Active Disputes** (PENDING/UNDER_REVIEW):
   - Orders are **skipped** in status updates
   - No automatic progression until dispute is resolved

2. **Resolved Disputes**:
   - Orders can proceed with status updates
   - Payment calculations include dispute adjustments
   - Admin decision determines payment amounts:
     - **SELLER favor**: Full payment (100%)
     - **BUYER favor**: Adjusted payment (100% - dispute percentage)

### Payment Calculations with Disputes

```javascript
// Example: Buyer wins 30% dispute on ฿1000 order
Original Amount: ฿1000
Dispute Adjustment: ฿1000 * (100% - 30%) = ฿700
Service Charge: ฿700 * 5% = ฿35
Tax: ฿700 * 7% = ฿49
Net to Seller: ฿700 - ฿35 - ฿49 = ฿616
```

## 🎯 Admin Transactions Features

### Enhanced Filtering
- Amount range (min/max)
- Order status
- Payment status
- Seller paid status
- Dispute existence (has/no dispute)
- Date range
- Seller/Buyer ID

### Transaction Details
Each transaction includes:
- Order information
- Buyer/Seller details
- Payment breakdown
- Payout calculations
- Dispute information (if any)
- Platform revenue breakdown

### Dispute Information Display
- Dispute status badges
- Dispute type and description
- Admin decisions and notes
- Resolution details
- Impact on payments

## 🚨 Error Handling & Safety

### Validation Checks
- System state validation (fee settings, database connectivity)
- Order integrity checks (seller/buyer account status)
- Payment validation (prevent duplicates)
- Dispute state validation
- Amount calculations validation

### Error Recovery
- Transaction rollback on failures
- Detailed error logging
- Email alerts for critical failures
- Retry mechanisms with backoff

### Safety Features
- Prevents duplicate seller payments
- Validates all calculations
- Checks account statuses
- Handles edge cases gracefully

## 📊 Performance & Metrics

### Built-in Statistics
- Processing duration
- Orders processed by type
- Payments processed
- Disputes handled
- Error counts and details

### Logging Levels
- **INFO**: General operation status
- **WARN**: Non-critical issues (skipped orders)
- **ERROR**: Processing failures
- **DEBUG**: Detailed execution traces (verbose mode)

## 🔧 Maintenance

### Regular Checks
1. Monitor health check endpoint
2. Review error logs
3. Validate fee settings
4. Check dispute resolution process
5. Monitor payment processing

### Troubleshooting
1. Check system validation errors
2. Review dispute status conflicts
3. Validate database connectivity
4. Check fee setting configurations
5. Review transaction logs

## 📝 API Documentation

### Get Transactions (Enhanced)
```
GET /order/admin/transactions?pageNo=1&size=10&hasDispute=true&disputeStatus=RESOLVED
```

Response includes:
- Transaction list with dispute information
- Pagination details
- Filter information
- Applied filters summary

### Get Payout Calculation
```
GET /order/admin/payoutCalculation/:orderId
```

Includes dispute-adjusted calculations and detailed breakdown.

### Mark Seller as Paid
```
POST /order/admin/markSellerPaid
{
  "orderId": "...",
  "notes": "Manual payment processed"
}
```

Includes validation for dispute status and payment eligibility.

---

## 🎉 Summary

This enhanced system provides:

1. **Robust Order Processing**: Automatic status updates with proper dispute handling
2. **Comprehensive Admin Tools**: Enhanced UI for managing transactions and disputes
3. **Safety & Reliability**: Multiple validation layers and error handling
4. **Monitoring & Maintenance**: Health checks, logging, and manual testing tools
5. **Scalability**: Configurable limits and performance monitoring

The system ensures that orders progress through their lifecycle properly while handling disputes appropriately and providing administrators with the tools they need to manage the platform effectively. 