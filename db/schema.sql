/* =====================================================================
   Group CRM: ระบบสมาชิกหลายแบรนด์ หลายสาขา ผูกกับ LINE OA (แบบ C)
   1 คน = 1 Member ID · แต้มแยกกระเป๋าตามแบรนด์ · OA แยกตามแบรนด์
   Target: SQL Server 2019+ (schema แยก crm.* จาก dbo.* ของ POS เดิม)
   ===================================================================== */
IF SCHEMA_ID('crm') IS NULL EXEC('CREATE SCHEMA crm');
GO

/* ---------- องค์กร: แบรนด์ / สาขา / ช่องทาง LINE ---------- */
CREATE TABLE crm.Brands (
  BrandId        varchar(20)   NOT NULL PRIMARY KEY,          -- 'narai','wakame','humlai'
  Name           nvarchar(100) NOT NULL,
  CodePrefix     char(2)       NOT NULL UNIQUE,               -- NR / WK / HL (ใช้ในโค้ดคูปอง เลขบิล)
  ThemeColor     char(7)       NOT NULL,                      -- สีหลักของ LIFF เมื่อเปิดจาก OA แบรนด์นี้
  LogoImageId    int           NULL,
  IsActive       bit           NOT NULL DEFAULT 1,
  CreatedAt      datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE crm.Branches (
  BranchId       varchar(10)   NOT NULL PRIMARY KEY,          -- 'HL01'
  BrandId        varchar(20)   NOT NULL REFERENCES crm.Brands(BrandId),
  Name           nvarchar(100) NOT NULL,
  Phone          varchar(20)   NULL,
  OpenTime       time(0)       NULL,
  CloseTime      time(0)       NULL,
  Lat            decimal(9,6)  NULL,
  Lng            decimal(9,6)  NULL,
  PosMode        varchar(10)   NOT NULL DEFAULT 'api' CHECK (PosMode IN ('api','manual')),
  EarnEnabled    bit           NOT NULL DEFAULT 1,            -- ปิดสะสมแต้มรายสาขาได้
  IsActive       bit           NOT NULL DEFAULT 1
);
CREATE INDEX IX_Branches_Brand ON crm.Branches(BrandId);

-- 1 แถวต่อ 1 LINE OA (Messaging API channel) · ทุกแถวต้องอยู่ Provider เดียวกัน
CREATE TABLE crm.LineChannels (
  ChannelId      varchar(20)   NOT NULL PRIMARY KEY,          -- Messaging API channel ID
  BrandId        varchar(20)   NOT NULL UNIQUE REFERENCES crm.Brands(BrandId),
  BotUserId      varchar(40)   NOT NULL UNIQUE,               -- ค่า "destination" ใน webhook ใช้ระบุ OA
  BasicId        varchar(30)   NOT NULL,                      -- @xxxx
  SecretRef      varchar(100)  NOT NULL,                      -- ชื่อ secret ใน Key Vault (ไม่เก็บค่าจริงใน DB)
  TokenRef       varchar(100)  NOT NULL,
  RichMenuId     varchar(60)   NULL,
  MonthlyQuota   int           NULL
);

/* ---------- สมาชิก ---------- */
CREATE SEQUENCE crm.MemberNo AS int START WITH 12846;

CREATE TABLE crm.Members (
  MemberId       char(10)      NOT NULL PRIMARY KEY,          -- 'MB-0012846' ใช้ได้ทุกแบรนด์
  FullName       nvarchar(150) NOT NULL,
  Phone          varchar(15)   NOT NULL,
  PhoneVerifiedAt datetime2(0) NULL,
  BirthDate      date          NULL,
  HomeBranchId   varchar(10)   NULL REFERENCES crm.Branches(BranchId),
  JoinedBrandId  varchar(20)   NOT NULL REFERENCES crm.Brands(BrandId),   -- สมัครผ่าน OA ไหน
  Status         varchar(10)   NOT NULL DEFAULT 'active' CHECK (Status IN ('active','merged','closed')),
  MergedInto     char(10)      NULL,
  PrivacyAcceptedAt datetime2(0) NOT NULL,
  PrivacyVersion varchar(20)   NOT NULL,
  CreatedAt      datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt      datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_Members_Phone ON crm.Members(Phone) WHERE Status = 'active';

-- ตัวตน LINE: userId เดียวกันทุก OA เพราะอยู่ Provider เดียว
CREATE TABLE crm.MemberLineIdentities (
  LineUserId     varchar(40)   NOT NULL PRIMARY KEY,
  MemberId       char(10)      NOT NULL REFERENCES crm.Members(MemberId),
  DisplayName    nvarchar(100) NULL,
  PictureUrl     varchar(400)  NULL,
  LinkedAt       datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_LineId_Member ON crm.MemberLineIdentities(MemberId);

-- สถานะต่อแบรนด์: เป็นเพื่อน OA ไหม + ยินยอมรับการตลาดไหม (PDPA แยกรายแบรนด์)
CREATE TABLE crm.MemberBrandLinks (
  MemberId       char(10)      NOT NULL REFERENCES crm.Members(MemberId),
  BrandId        varchar(20)   NOT NULL REFERENCES crm.Brands(BrandId),
  FollowStatus   varchar(10)   NOT NULL DEFAULT 'none' CHECK (FollowStatus IN ('none','follow','blocked')),
  FollowChangedAt datetime2(0) NULL,
  MarketingConsent bit         NOT NULL DEFAULT 0,
  ConsentChangedAt datetime2(0) NULL,
  FirstVisitAt   datetime2(0)  NULL,
  LastVisitAt    datetime2(0)  NULL,
  PRIMARY KEY (MemberId, BrandId)
);

-- คนที่แอด OA แต่ยังไม่สมัคร (จาก follow event) เพื่อดู funnel
CREATE TABLE crm.LineFollowers (
  LineUserId     varchar(40)   NOT NULL,
  BrandId        varchar(20)   NOT NULL REFERENCES crm.Brands(BrandId),
  Status         varchar(10)   NOT NULL CHECK (Status IN ('follow','blocked')),
  ChangedAt      datetime2(0)  NOT NULL,
  PRIMARY KEY (LineUserId, BrandId)
);

/* ---------- กฎแต้ม / ระดับ ---------- */
CREATE TABLE crm.EarnRules (
  RuleId         int IDENTITY  PRIMARY KEY,
  BrandId        varchar(20)   NOT NULL REFERENCES crm.Brands(BrandId),
  BahtPerUnit    decimal(10,2) NOT NULL CHECK (BahtPerUnit > 0),   -- ทุก X บาท
  PointsPerUnit  int           NOT NULL CHECK (PointsPerUnit >= 0),-- = Y แต้ม
  BaseAmount     varchar(10)   NOT NULL DEFAULT 'net' CHECK (BaseAmount IN ('net','exvat','gross')),
  Rounding       varchar(10)   NOT NULL DEFAULT 'floor' CHECK (Rounding IN ('floor','round')),
  ExpiryMonths   int           NOT NULL DEFAULT 12,               -- 0 = ไม่หมดอายุ
  WelcomePoints  int           NOT NULL DEFAULT 0,
  BackdateDays   int           NOT NULL DEFAULT 3,                -- ขอแต้มย้อนหลังได้กี่วัน
  GoldAt         int           NOT NULL,
  PlatinumAt     int           NOT NULL,
  EffectiveFrom  datetime2(0)  NOT NULL,
  EffectiveTo    datetime2(0)  NULL,                              -- เก็บประวัติกฎ ไม่แก้ทับ
  CreatedBy      varchar(10)   NOT NULL
);
CREATE INDEX IX_EarnRules_Brand ON crm.EarnRules(BrandId, EffectiveFrom DESC);

CREATE TABLE crm.PointMultipliers (                                 -- แคมเปญคูณแต้ม
  MultiplierId   int IDENTITY  PRIMARY KEY,
  BrandId        varchar(20)   NOT NULL REFERENCES crm.Brands(BrandId),
  Name           nvarchar(100) NOT NULL,
  Multiplier     decimal(4,2)  NOT NULL,
  DaysOfWeek     varchar(13)   NULL,        -- '3' หรือ '1,2,3'
  MenuItemIds    nvarchar(max) NULL,        -- JSON: คูณเฉพาะเมนู
  BranchIds      nvarchar(max) NULL,
  StartAt        datetime2(0)  NOT NULL,
  EndAt          datetime2(0)  NOT NULL
);

/* ---------- ธุรกรรมจาก POS ---------- */
CREATE TABLE crm.SalesTransactions (
  TxnId          bigint IDENTITY PRIMARY KEY,
  PosBillId      varchar(40)   NOT NULL,                      -- เลขบิลจาก POS
  BranchId       varchar(10)   NOT NULL REFERENCES crm.Branches(BranchId),
  BrandId        varchar(20)   NOT NULL REFERENCES crm.Brands(BrandId),
  MemberId       char(10)      NULL REFERENCES crm.Members(MemberId),
  Channel        varchar(10)   NOT NULL CHECK (Channel IN ('pos','kiosk','liff','manual')),
  Subtotal       decimal(12,2) NOT NULL,
  Discount       decimal(12,2) NOT NULL DEFAULT 0,
  Total          decimal(12,2) NOT NULL,
  PointsEarned   int           NOT NULL DEFAULT 0,
  RuleId         int           NULL REFERENCES crm.EarnRules(RuleId),
  Status         varchar(10)   NOT NULL DEFAULT 'paid' CHECK (Status IN ('paid','partial_refund','refunded','void')),
  PaidAt         datetime2(0)  NOT NULL,
  StaffId        varchar(10)   NULL,
  ItemsJson      nvarchar(max) NULL,
  CONSTRAINT UX_Sales_PosBill UNIQUE (BranchId, PosBillId)    -- กันบิลซ้ำ (idempotency)
);
CREATE INDEX IX_Sales_Member ON crm.SalesTransactions(MemberId, PaidAt DESC) WHERE MemberId IS NOT NULL;
CREATE INDEX IX_Sales_Branch ON crm.SalesTransactions(BranchId, PaidAt DESC);

CREATE TABLE crm.Refunds (
  RefundId       bigint IDENTITY PRIMARY KEY,
  TxnId          bigint        NOT NULL REFERENCES crm.SalesTransactions(TxnId),
  PosRefundId    varchar(40)   NOT NULL UNIQUE,
  Amount         decimal(12,2) NOT NULL,
  PointsReversed int           NOT NULL,
  CreatedAt      datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME()
);

/* ---------- แต้ม: Ledger + Lots (ห้ามแก้ยอดตรง) ---------- */
CREATE TABLE crm.Wallets (                                         -- 1 สมาชิก 1 กระเป๋าต่อแบรนด์
  MemberId       char(10)      NOT NULL REFERENCES crm.Members(MemberId),
  BrandId        varchar(20)   NOT NULL REFERENCES crm.Brands(BrandId),
  Balance        int           NOT NULL DEFAULT 0 CHECK (Balance >= 0),   -- แต้มห้ามติดลบ
  EarnedLast12m  int           NOT NULL DEFAULT 0,                        -- ใช้คิดระดับ
  Tier           varchar(10)   NOT NULL DEFAULT 'SILVER',
  RowVer         rowversion,
  PRIMARY KEY (MemberId, BrandId)
);

CREATE TABLE crm.PointLedger (
  LedgerId       bigint IDENTITY PRIMARY KEY,
  MemberId       char(10)      NOT NULL,
  BrandId        varchar(20)   NOT NULL,
  BranchId       varchar(10)   NULL,
  EntryType      varchar(10)   NOT NULL CHECK (EntryType IN ('earn','welcome','bonus','redeem','refund','adjust','expire','merge')),
  Points         int           NOT NULL,                      -- + เข้า / − ออก
  BalanceAfter   int           NOT NULL,
  RefType        varchar(20)   NULL,                          -- 'sale','redemption','adjustment'
  RefId          varchar(40)   NULL,
  IdempotencyKey varchar(80)   NOT NULL UNIQUE,
  Note           nvarchar(200) NULL,
  ActorType      varchar(10)   NOT NULL,                      -- system/pos/staff/member/line
  ActorId        varchar(40)   NULL,
  CreatedAt      datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
  FOREIGN KEY (MemberId, BrandId) REFERENCES crm.Wallets(MemberId, BrandId)
);
CREATE INDEX IX_Ledger_Member ON crm.PointLedger(MemberId, BrandId, CreatedAt DESC);

CREATE TABLE crm.PointLots (                                       -- แต้มแต่ละล็อตหมดอายุของตัวเอง (FIFO)
  LotId          bigint IDENTITY PRIMARY KEY,
  MemberId       char(10)      NOT NULL,
  BrandId        varchar(20)   NOT NULL,
  SourceLedgerId bigint        NOT NULL REFERENCES crm.PointLedger(LedgerId),
  Points         int           NOT NULL,
  Remaining      int           NOT NULL CHECK (Remaining >= 0),
  ExpiresAt      datetime2(0)  NULL
);
CREATE INDEX IX_Lots_Open ON crm.PointLots(MemberId, BrandId, ExpiresAt) WHERE Remaining > 0;

CREATE TABLE crm.PointAdjustRequests (
  RequestId      int IDENTITY  PRIMARY KEY,
  MemberId       char(10)      NOT NULL REFERENCES crm.Members(MemberId),
  BrandId        varchar(20)   NOT NULL,
  BranchId       varchar(10)   NULL,
  Points         int           NOT NULL,
  Reason         nvarchar(300) NOT NULL,
  RefPosBillId   varchar(40)   NULL,
  RequestedBy    varchar(10)   NOT NULL,
  Status         varchar(10)   NOT NULL DEFAULT 'pending' CHECK (Status IN ('pending','approved','rejected')),
  DecidedBy      varchar(10)   NULL,
  DecidedAt      datetime2(0)  NULL,
  CreatedAt      datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_Adjust_TwoPeople CHECK (DecidedBy IS NULL OR DecidedBy <> RequestedBy)
);

/* ---------- รางวัล / คูปอง ---------- */
CREATE TABLE crm.Rewards (
  RewardId       int IDENTITY  PRIMARY KEY,
  BrandId        varchar(20)   NOT NULL REFERENCES crm.Brands(BrandId),
  Name           nvarchar(150) NOT NULL,
  Category       varchar(20)   NOT NULL,
  PointsCost     int           NOT NULL CHECK (PointsCost > 0),
  CouponTemplateId int         NOT NULL,
  Stock          int           NULL,                          -- NULL = ไม่จำกัด
  PerMemberLimit int           NULL,
  ImageId        int           NULL,
  IsActive       bit           NOT NULL DEFAULT 1,
  StartAt        datetime2(0)  NULL,
  EndAt          datetime2(0)  NULL
);

CREATE TABLE crm.CouponTemplates (
  CouponTemplateId int IDENTITY PRIMARY KEY,
  BrandId        varchar(20)   NULL REFERENCES crm.Brands(BrandId),   -- NULL = ใช้ได้ทุกแบรนด์ (ข้ามแบรนด์)
  Title          nvarchar(150) NOT NULL,
  DiscountType   varchar(10)   NOT NULL CHECK (DiscountType IN ('baht','pct','item')),
  DiscountValue  decimal(10,2) NOT NULL,
  MenuItemId     varchar(20)   NULL,
  MinSpend       decimal(10,2) NOT NULL DEFAULT 0,
  ValidDays      int           NOT NULL DEFAULT 30,
  BranchIds      nvarchar(max) NULL
);

CREATE TABLE crm.MemberCoupons (
  CouponId       bigint IDENTITY PRIMARY KEY,
  Code           varchar(12)   NOT NULL UNIQUE,               -- HL-7JCQ
  CouponTemplateId int         NOT NULL REFERENCES crm.CouponTemplates(CouponTemplateId),
  MemberId       char(10)      NOT NULL REFERENCES crm.Members(MemberId),
  BrandId        varchar(20)   NULL,
  Source         varchar(10)   NOT NULL CHECK (Source IN ('welcome','redeem','campaign','code','birthday','manual')),
  SourceRef      varchar(40)   NULL,
  Status         varchar(10)   NOT NULL DEFAULT 'ready' CHECK (Status IN ('ready','used','expired','void')),
  IssuedAt       datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
  ExpiresAt      datetime2(0)  NOT NULL,
  UsedAt         datetime2(0)  NULL,
  UsedTxnId      bigint        NULL REFERENCES crm.SalesTransactions(TxnId),
  UsedBranchId   varchar(10)   NULL,
  UsedBy         varchar(10)   NULL,
  RowVer         rowversion
);
CREATE INDEX IX_Coupons_Member ON crm.MemberCoupons(MemberId, Status, ExpiresAt);

/* ---------- การตลาด ---------- */
CREATE TABLE crm.Campaigns (
  CampaignId     int IDENTITY  PRIMARY KEY,
  BrandId        varchar(20)   NOT NULL REFERENCES crm.Brands(BrandId),  -- ส่งจาก OA ไหน
  Name           nvarchar(150) NOT NULL,
  SegmentJson    nvarchar(max) NOT NULL,                      -- {"type":"lapsed","days":30}
  MessageJson    nvarchar(max) NOT NULL,                      -- LINE message objects / Flex
  CouponTemplateId int         NULL,
  ScheduledAt    datetime2(0)  NULL,
  Status         varchar(10)   NOT NULL DEFAULT 'draft' CHECK (Status IN ('draft','scheduled','sending','sent','failed')),
  Recipients     int           NULL,
  CreatedBy      varchar(10)   NOT NULL,
  CreatedAt      datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE crm.CampaignRecipients (
  CampaignId     int           NOT NULL REFERENCES crm.Campaigns(CampaignId),
  MemberId       char(10)      NOT NULL,
  LineUserId     varchar(40)   NOT NULL,
  SentAt         datetime2(0)  NULL,
  Error          nvarchar(200) NULL,
  PRIMARY KEY (CampaignId, MemberId)
);

/* ---------- ผู้ใช้หลังบ้าน / สิทธิ์ / ตรวจสอบ ---------- */
CREATE TABLE crm.Staff (
  StaffId        varchar(10)   NOT NULL PRIMARY KEY,
  Name           nvarchar(100) NOT NULL,
  LineUserId     varchar(40)   NULL UNIQUE,                   -- ล็อกอินเว็บพนักงานด้วย LINE ได้
  Email          varchar(150)  NULL UNIQUE,
  Role           varchar(12)   NOT NULL CHECK (Role IN ('super','marketing','brand','branchmgr','cashier')),
  IsActive       bit           NOT NULL DEFAULT 1
);
CREATE TABLE crm.StaffScopes (                                     -- ขอบเขต: ทั้งเครือ / แบรนด์ / สาขา
  StaffId        varchar(10)   NOT NULL REFERENCES crm.Staff(StaffId),
  ScopeType      varchar(6)    NOT NULL CHECK (ScopeType IN ('group','brand','branch')),
  ScopeId        varchar(20)   NOT NULL DEFAULT '*',
  ApproveLimit   int           NULL,                          -- วงเงินอนุมัติแต้มของ Branch Manager
  PRIMARY KEY (StaffId, ScopeType, ScopeId)
);
CREATE TABLE crm.PosTerminals (                                    -- เครื่อง POS / Kiosk ที่เรียก API ได้
  TerminalId     varchar(20)   NOT NULL PRIMARY KEY,
  BranchId       varchar(10)   NOT NULL REFERENCES crm.Branches(BranchId),
  ApiKeyHash     varbinary(64) NOT NULL,
  Kind           varchar(6)    NOT NULL CHECK (Kind IN ('pos','kiosk')),
  LastSeenAt     datetime2(0)  NULL
);

CREATE TABLE crm.AuditLogs (                                       -- append-only (DENY UPDATE, DELETE ให้ role แอป)
  AuditId        bigint IDENTITY PRIMARY KEY,
  At             datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
  ActorType      varchar(10)   NOT NULL,
  ActorId        varchar(40)   NULL,
  Action         varchar(50)   NOT NULL,
  EntityType     varchar(30)   NULL,
  EntityId       varchar(40)   NULL,
  BeforeJson     nvarchar(max) NULL,
  AfterJson      nvarchar(max) NULL,
  Ip             varchar(45)   NULL
);

CREATE TABLE crm.WebhookEvents (                                   -- กัน LINE ส่ง event ซ้ำ
  WebhookEventId varchar(40)   NOT NULL PRIMARY KEY,          -- webhookEventId จาก LINE
  BrandId        varchar(20)   NOT NULL,
  EventType      varchar(20)   NOT NULL,
  IsRedelivery   bit           NOT NULL DEFAULT 0,
  ReceivedAt     datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
  ProcessedAt    datetime2(0)  NULL,
  PayloadJson    nvarchar(max) NOT NULL
);

CREATE TABLE crm.Outbox (                                          -- ข้อความ push / งานเบื้องหลัง (ส่งหลัง commit)
  OutboxId       bigint IDENTITY PRIMARY KEY,
  Kind           varchar(20)   NOT NULL,                      -- 'line_push','line_multicast','sms_otp'
  BrandId        varchar(20)   NULL,
  PayloadJson    nvarchar(max) NOT NULL,
  Attempts       int           NOT NULL DEFAULT 0,
  NextAttemptAt  datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
  DoneAt         datetime2(0)  NULL
);
CREATE INDEX IX_Outbox_Pending ON crm.Outbox(NextAttemptAt) WHERE DoneAt IS NULL;
GO

/* ---------- ตัวอย่าง: สะสมแต้มจากบิล (atomic + idempotent) ----------
   เรียกจาก POST /pos/transactions หลังคำนวณแต้มใน service แล้ว */
CREATE OR ALTER PROCEDURE crm.usp_EarnFromSale
  @BranchId varchar(10), @PosBillId varchar(40), @MemberId char(10), @Points int,
  @Subtotal decimal(12,2), @Discount decimal(12,2), @Total decimal(12,2), @RuleId int,
  @Channel varchar(10), @StaffId varchar(10), @ItemsJson nvarchar(max), @ExpiryMonths int
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @BrandId varchar(20) = (SELECT BrandId FROM crm.Branches WHERE BranchId = @BranchId);
  DECLARE @Key varchar(80) = 'sale:' + @BranchId + ':' + @PosBillId;

  BEGIN TRAN;
    IF EXISTS (SELECT 1 FROM crm.SalesTransactions WITH (UPDLOCK, HOLDLOCK) WHERE BranchId = @BranchId AND PosBillId = @PosBillId)
    BEGIN
      COMMIT; SELECT 'duplicate' AS Result; RETURN;            -- ส่งซ้ำ: ไม่ให้แต้มซ้ำ
    END

    INSERT crm.SalesTransactions (PosBillId, BranchId, BrandId, MemberId, Channel, Subtotal, Discount, Total, PointsEarned, RuleId, PaidAt, StaffId, ItemsJson)
    VALUES (@PosBillId, @BranchId, @BrandId, @MemberId, @Channel, @Subtotal, @Discount, @Total, @Points, @RuleId, SYSUTCDATETIME(), @StaffId, @ItemsJson);

    IF @MemberId IS NOT NULL AND @Points > 0
    BEGIN
      MERGE crm.Wallets WITH (HOLDLOCK) AS w
      USING (SELECT @MemberId AS MemberId, @BrandId AS BrandId) s ON w.MemberId = s.MemberId AND w.BrandId = s.BrandId
      WHEN NOT MATCHED THEN INSERT (MemberId, BrandId) VALUES (s.MemberId, s.BrandId);

      UPDATE crm.Wallets SET Balance = Balance + @Points, EarnedLast12m = EarnedLast12m + @Points
      WHERE MemberId = @MemberId AND BrandId = @BrandId;

      DECLARE @Bal int = (SELECT Balance FROM crm.Wallets WHERE MemberId = @MemberId AND BrandId = @BrandId);
      INSERT crm.PointLedger (MemberId, BrandId, BranchId, EntryType, Points, BalanceAfter, RefType, RefId, IdempotencyKey, Note, ActorType, ActorId)
      VALUES (@MemberId, @BrandId, @BranchId, 'earn', @Points, @Bal, 'sale', @PosBillId, @Key, N'ชำระบิล ' + @PosBillId, 'pos', @StaffId);

      INSERT crm.PointLots (MemberId, BrandId, SourceLedgerId, Points, Remaining, ExpiresAt)
      VALUES (@MemberId, @BrandId, SCOPE_IDENTITY(), @Points, @Points,
              CASE WHEN @ExpiryMonths > 0 THEN DATEADD(month, @ExpiryMonths, SYSUTCDATETIME()) END);

      INSERT crm.Outbox (Kind, BrandId, PayloadJson)
      VALUES ('line_push', @BrandId, (SELECT @MemberId AS memberId, @PosBillId AS billId, @Points AS points, @Bal AS balance, 'points_earned' AS template FOR JSON PATH, WITHOUT_ARRAY_WRAPPER));
    END
  COMMIT;
  SELECT 'created' AS Result;
END
GO
