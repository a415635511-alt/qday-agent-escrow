// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title Minimal ERC-20 interface for QDay Aevum tUSD8 (6 decimals)
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function decimals() external view returns (uint8);
}

/// @title MockTUSD8 — Local test stablecoin mirroring Aevum tUSD8 (6 decimals)
contract MockTUSD8 {
    string public constant name = "Test USD8";
    string public constant symbol = "tUSD8";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "INSUFFICIENT_BALANCE");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "INSUFFICIENT_BALANCE");
        require(allowance[from][msg.sender] >= amount, "INSUFFICIENT_ALLOWANCE");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/// @title AgentPayGuard — Programmable tUSD8 Invoice Escrow with Confirmation of Payee,
///        Agent Spending Caps, Verifiable Deliverable Receipts & Instant Revocation
/// @notice Designed for QDay Aevum Testnet (Chain ID 44005, tUSD8 0x456569838f1d43009A91ebA4263147Afd7233483)
contract AgentPayGuard {
    IERC20 public immutable token;

    enum InvoiceStatus {
        NONE,
        FUNDED,
        DELIVERED,
        RELEASED,
        REFUNDED,
        DISPUTED
    }

    struct PayeeProfile {
        bytes32 nameHash;      // keccak256(canonical legal/handle name)
        bytes32 metadataHash;  // keccak256(off-chain verification URI / tax or handle proof)
        bool registered;
    }

    struct AgentMandate {
        uint256 maxPerInvoice; // Max tUSD8 (6 dec) per single invoice
        uint256 dailyLimit;    // Max tUSD8 (6 dec) per 24h rolling window
        uint256 spentToday;
        uint64 windowStart;
        uint64 expiresAt;
        bool active;
    }

    struct Invoice {
        uint256 id;
        address payer;         // Human/treasury principal funding the escrow
        address agent;         // Optional AI agent authorized to create/verify
        address payee;
        bytes32 expectedPayeeNameHash; // Confirmation of Payee (CoP) check
        uint256 amount;        // tUSD8 base units (6 decimals)
        uint64 deadline;
        bytes32 specHash;      // keccak256 of task/invoice spec
        bytes32 receiptHash;   // keccak256 of delivered artifact/proof
        InvoiceStatus status;
    }

    uint256 public nextInvoiceId = 1;
    mapping(address => PayeeProfile) public payees;
    mapping(address => mapping(address => AgentMandate)) public mandates; // payer => agent => mandate
    mapping(uint256 => Invoice) public invoices;

    event PayeeRegistered(address indexed payee, bytes32 indexed nameHash, bytes32 metadataHash);
    event MandateConfigured(
        address indexed payer,
        address indexed agent,
        uint256 maxPerInvoice,
        uint256 dailyLimit,
        uint64 expiresAt
    );
    event MandateRevoked(address indexed payer, address indexed agent);
    event InvoiceFunded(
        uint256 indexed invoiceId,
        address indexed payer,
        address indexed payee,
        address agent,
        uint256 amount,
        uint64 deadline,
        bytes32 specHash
    );
    event DeliverableSubmitted(uint256 indexed invoiceId, address indexed payee, bytes32 receiptHash);
    event InvoiceReleased(uint256 indexed invoiceId, address indexed payee, uint256 amount, address releasedBy);
    event InvoiceRefunded(uint256 indexed invoiceId, address indexed payer, uint256 amount, string reason);
    event InvoiceDisputed(uint256 indexed invoiceId, address indexed caller, bytes32 evidenceHash);

    constructor(address _token) {
        require(_token != address(0), "ZERO_TOKEN");
        token = IERC20(_token);
    }

    /// @notice Confirmation of Payee (CoP) registry: payee commits canonical name hash before receiving funds
    function registerPayee(bytes32 nameHash, bytes32 metadataHash) external {
        require(nameHash != bytes32(0), "EMPTY_NAME_HASH");
        payees[msg.sender] = PayeeProfile({
            nameHash: nameHash,
            metadataHash: metadataHash,
            registered: true
        });
        emit PayeeRegistered(msg.sender, nameHash, metadataHash);
    }

    /// @notice Principal grants bounded spending authority to an AI agent
    function setAgentMandate(
        address agent,
        uint256 maxPerInvoice,
        uint256 dailyLimit,
        uint64 expiresAt
    ) external {
        require(agent != address(0), "ZERO_AGENT");
        require(maxPerInvoice > 0 && dailyLimit >= maxPerInvoice, "INVALID_LIMITS");
        require(expiresAt > block.timestamp, "EXPIRED_MANDATE");

        mandates[msg.sender][agent] = AgentMandate({
            maxPerInvoice: maxPerInvoice,
            dailyLimit: dailyLimit,
            spentToday: 0,
            windowStart: uint64(block.timestamp),
            expiresAt: expiresAt,
            active: true
        });

        emit MandateConfigured(msg.sender, agent, maxPerInvoice, dailyLimit, expiresAt);
    }

    /// @notice Instant revocation — principal can cut off an agent immediately in 1 tx
    function revokeAgentMandate(address agent) external {
        mandates[msg.sender][agent].active = false;
        emit MandateRevoked(msg.sender, agent);
    }

    /// @notice Create and fund a tUSD8 invoice escrow with mandatory Confirmation of Payee (CoP) match
    function createAndFundInvoice(
        address payer,
        address payee,
        bytes32 expectedPayeeNameHash,
        uint256 amount,
        uint64 deadline,
        bytes32 specHash
    ) external returns (uint256 invoiceId) {
        require(payer != address(0) && payee != address(0), "ZERO_ADDRESS");
        require(amount > 0, "ZERO_AMOUNT");
        require(deadline > block.timestamp, "PAST_DEADLINE");

        // Confirmation of Payee (CoP): prevents misdirected stablecoin payouts
        PayeeProfile memory profile = payees[payee];
        require(profile.registered, "PAYEE_NOT_REGISTERED");
        require(profile.nameHash == expectedPayeeNameHash, "COP_NAME_MISMATCH");

        address actingAgent = address(0);
        if (msg.sender != payer) {
            actingAgent = msg.sender;
            AgentMandate storage m = mandates[payer][actingAgent];
            require(m.active, "MANDATE_INACTIVE");
            require(block.timestamp <= m.expiresAt, "MANDATE_EXPIRED");
            require(amount <= m.maxPerInvoice, "EXCEEDS_PER_INVOICE_CAP");

            if (block.timestamp >= uint256(m.windowStart) + 1 days) {
                m.windowStart = uint64(block.timestamp);
                m.spentToday = 0;
            }
            require(m.spentToday + amount <= m.dailyLimit, "EXCEEDS_DAILY_CAP");
            m.spentToday += amount;
        }

        require(token.transferFrom(payer, address(this), amount), "TRANSFER_FROM_FAILED");

        invoiceId = nextInvoiceId++;
        invoices[invoiceId] = Invoice({
            id: invoiceId,
            payer: payer,
            agent: actingAgent,
            payee: payee,
            expectedPayeeNameHash: expectedPayeeNameHash,
            amount: amount,
            deadline: deadline,
            specHash: specHash,
            receiptHash: bytes32(0),
            status: InvoiceStatus.FUNDED
        });

        emit InvoiceFunded(invoiceId, payer, payee, actingAgent, amount, deadline, specHash);
    }

    /// @notice Payee submits cryptographic proof of delivered work/goods
    function submitDeliverable(uint256 invoiceId, bytes32 receiptHash) external {
        Invoice storage inv = invoices[invoiceId];
        require(inv.status == InvoiceStatus.FUNDED, "NOT_FUNDED");
        require(msg.sender == inv.payee, "ONLY_PAYEE");
        require(receiptHash != bytes32(0), "EMPTY_RECEIPT");

        inv.receiptHash = receiptHash;
        inv.status = InvoiceStatus.DELIVERED;
        emit DeliverableSubmitted(invoiceId, msg.sender, receiptHash);
    }

    /// @notice Payer (or their still-active authorized agent) releases escrowed tUSD8 to payee
    function releaseInvoice(uint256 invoiceId) external {
        Invoice storage inv = invoices[invoiceId];
        require(inv.status == InvoiceStatus.FUNDED || inv.status == InvoiceStatus.DELIVERED, "INVALID_STATE");

        bool authorized = (msg.sender == inv.payer);
        if (!authorized && msg.sender == inv.agent && inv.agent != address(0)) {
            AgentMandate storage m = mandates[inv.payer][inv.agent];
            authorized = m.active && block.timestamp <= m.expiresAt;
        }
        require(authorized, "NOT_AUTHORIZED_RELEASE");

        inv.status = InvoiceStatus.RELEASED;
        require(token.transfer(inv.payee, inv.amount), "TRANSFER_FAILED");
        emit InvoiceReleased(invoiceId, inv.payee, inv.amount, msg.sender);
    }

    /// @notice Payer reclaims funds if deadline passed without release (or payee voluntarily refunds)
    function refundInvoice(uint256 invoiceId, string calldata reason) external {
        Invoice storage inv = invoices[invoiceId];
        require(inv.status == InvoiceStatus.FUNDED || inv.status == InvoiceStatus.DELIVERED, "INVALID_STATE");

        bool payeeCancel = (msg.sender == inv.payee);
        bool payerExpired = (msg.sender == inv.payer && block.timestamp > inv.deadline);
        require(payeeCancel || payerExpired, "REFUND_NOT_ALLOWED");

        inv.status = InvoiceStatus.REFUNDED;
        require(token.transfer(inv.payer, inv.amount), "TRANSFER_FAILED");
        emit InvoiceRefunded(invoiceId, inv.payer, inv.amount, reason);
    }

    /// @notice Freeze invoice in disputed state so neither side can unilaterally move funds
    function flagDispute(uint256 invoiceId, bytes32 evidenceHash) external {
        Invoice storage inv = invoices[invoiceId];
        require(inv.status == InvoiceStatus.FUNDED || inv.status == InvoiceStatus.DELIVERED, "INVALID_STATE");
        require(msg.sender == inv.payer || msg.sender == inv.payee, "ONLY_PARTY");

        inv.status = InvoiceStatus.DISPUTED;
        emit InvoiceDisputed(invoiceId, msg.sender, evidenceHash);
    }

    /// @notice Read-only Confirmation of Payee check for frontends/agents before signing
    function verifyPayee(address payee, bytes32 expectedNameHash) external view returns (bool ok, bytes32 metadataHash) {
        PayeeProfile memory p = payees[payee];
        return (p.registered && p.nameHash == expectedNameHash, p.metadataHash);
    }
}
