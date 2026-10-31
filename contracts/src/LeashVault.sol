// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LeashVault
/// @notice ETH spending rules for one agent, administered by a trusted human owner.
/// @dev Selector checks do not validate arguments or arbitrary downstream contract effects.
contract LeashVault {
    enum Decision {
        ALLOW,
        ASK_HUMAN,
        BLOCK
    }
    enum Reason {
        POLICY_PASSED,
        PER_TX_CAP,
        DAILY_CAP,
        ALLOWLIST,
        RATE_LIMIT,
        ACTIVE_HOURS,
        METHOD,
        PAUSED,
        NEEDS_APPROVAL,
        INSUFFICIENT_BALANCE
    }
    enum Status {
        NONE,
        PENDING,
        APPROVED,
        REJECTED
    }

    struct Policy {
        uint256 dailyCap;
        uint256 perTxCap;
        uint256 askAboveAmount;
        uint32 maxActionsPerHour;
        uint16 activeStartMinute;
        uint16 activeEndMinute;
        int16 utcOffsetMinutes;
    }

    struct Request {
        address target;
        uint256 amount;
        bytes data;
        bytes32 memoHash;
        bool isExecute;
        Status status;
    }

    error OnlyOwner();
    error OnlyAgent();
    error Reentrancy();
    error InvalidPolicy();
    error InvalidAddress();
    error NotPending();
    error CallFailed();

    event Deposited(uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event PolicySet(address indexed agent, Policy policy);
    event ReceiverSet(address indexed receiver, bool allowed);
    event SelectorSet(address indexed receiver, bytes4 indexed selector, bool allowed);
    event PauseSet(bool paused);
    event Blocked(
        address indexed caller,
        address indexed target,
        uint256 amount,
        Reason reason,
        bytes32 payloadHash,
        uint256 requestId
    );
    event Requested(
        uint256 indexed id, address indexed target, uint256 amount, bool isExecute, bytes data, bytes32 memoHash
    );
    event Spent(address indexed target, uint256 amount, bool isExecute, bytes32 payloadHash, uint256 requestId);
    event Approved(uint256 indexed id);
    event Rejected(uint256 indexed id);

    address public immutable owner;
    address public agent;
    Policy public policy;
    bool public paused;
    mapping(address => bool) public receivers;
    mapping(address => bool) public selectorRestricted;
    mapping(address => mapping(bytes4 => bool)) public selectors;
    mapping(int256 => uint256) public spentByDay;
    mapping(uint256 => Request) private requests;
    uint256 public nextRequestId = 1;
    uint256[] private actionTimes;
    bool private entered;

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert OnlyAgent();
        _;
    }

    modifier nonReentrant() {
        if (entered) revert Reentrancy();
        entered = true;
        _;
        entered = false;
    }

    /// @notice Starts deny-all until the owner configures policy and receivers.
    constructor(address owner_, address agent_) payable {
        if (owner_ == address(0) || agent_ == address(0)) revert InvalidAddress();
        owner = owner_;
        agent = agent_;
        if (msg.value != 0) emit Deposited(msg.value);
    }

    /// @notice Owner deposits ETH; forced ETH transfers may also increase the balance.
    receive() external payable nonReentrant onlyOwner {
        emit Deposited(msg.value);
    }

    /// @notice Equal start/end means all hours. Zero caps/rate deny spending; max uint disables ask.
    /// @dev Policy changes do not erase spend or rolling-hour history. Owner controls the day offset.
    function setPolicy(address agent_, Policy calldata p) external nonReentrant onlyOwner {
        if (agent_ == address(0)) revert InvalidAddress();
        if (
            p.activeStartMinute > 1439 || p.activeEndMinute > 1439 || p.utcOffsetMinutes < -720
                || p.utcOffsetMinutes > 840
        ) revert InvalidPolicy();
        agent = agent_;
        policy = p;
        emit PolicySet(agent_, p);
    }

    /// @notice Only exact receiver addresses are supported.
    function setReceiver(address receiver, bool allowed) external nonReentrant onlyOwner {
        if (receiver == address(0)) revert InvalidAddress();
        receivers[receiver] = allowed;
        emit ReceiverSet(receiver, allowed);
    }

    /// @notice First call enables selector restrictions permanently for this receiver, even when false.
    /// @dev An untouched receiver permits all selectors; removing its last selector denies all execute calls.
    function setSelector(address receiver, bytes4 selector, bool allowed) external nonReentrant onlyOwner {
        if (receiver == address(0)) revert InvalidAddress();
        selectorRestricted[receiver] = true;
        selectors[receiver][selector] = allowed;
        emit SelectorSet(receiver, selector, allowed);
    }

    function pause() external nonReentrant onlyOwner {
        paused = true;
        emit PauseSet(true);
    }

    function unpause() external nonReentrant onlyOwner {
        paused = false;
        emit PauseSet(false);
    }

    /// @notice Owner recovery is available even while paused and is outside agent spending limits.
    function withdraw(address payable to, uint256 amount) external nonReentrant onlyOwner {
        if (to == address(0)) revert InvalidAddress();
        emit Withdrawn(to, amount);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert CallFailed();
    }

    /// @notice Offset-adjusted calendar day, not a trailing 24-hour window.
    function currentDay() public view returns (int256) {
        int256 local = int256(block.timestamp) + int256(policy.utcOffsetMinutes) * 60;
        return local >= 0 ? local / 1 days : (local - (int256(1 days) - 1)) / 1 days;
    }

    function spentToday() public view returns (uint256) {
        return spentByDay[currentDay()];
    }

    /// @notice Successful payments and approvals strictly newer than timestamp minus one hour.
    /// @dev Binary search keeps reads logarithmic; history grows by one slot per successful action.
    function actionsLastHour() public view returns (uint256) {
        if (block.timestamp < 1 hours) return actionTimes.length;
        uint256 cutoff = block.timestamp - 1 hours;
        uint256 lo = 0;
        uint256 hi = actionTimes.length;
        while (lo < hi) {
            uint256 mid = lo + (hi - lo) / 2;
            if (actionTimes[mid] <= cutoff) lo = mid + 1;
            else hi = mid;
        }
        return actionTimes.length - lo;
    }

    function getRequest(uint256 id) external view returns (Request memory) {
        return requests[id];
    }

    /// @notice Read-only policy preview. Selector zero denotes pay; checkExecute handles actual zero selectors.
    /// @dev Does not simulate recipient code; an ALLOW can still fail when the recipient is called.
    function check(address to, uint256 amount, bytes4 selector) external view returns (Decision, Reason) {
        return _check(to, amount, selector, selector != bytes4(0), false);
    }

    /// @notice Preview execute, including malformed calldata and the zero-selector edge case.
    function checkExecute(address target, uint256 value, bytes calldata data) external view returns (Decision, Reason) {
        if (data.length < 4) return (Decision.BLOCK, Reason.METHOD);
        return _check(target, value, bytes4(data[:4]), true, false);
    }

    /// @notice Logs policy blocks, queues human review, or transfers ETH; id is zero unless queued.
    function pay(address to, uint256 amount, bytes32 memoHash)
        external
        nonReentrant
        onlyAgent
        returns (Decision, Reason, uint256)
    {
        return _submit(to, amount, "", memoHash, false);
    }

    /// @notice Applies payment rules plus an optional per-receiver function selector allowlist.
    function execute(address target, uint256 value, bytes calldata data)
        external
        nonReentrant
        onlyAgent
        returns (Decision, Reason, uint256)
    {
        if (data.length < 4) {
            emit Blocked(msg.sender, target, value, Reason.METHOD, keccak256(data), 0);
            return (Decision.BLOCK, Reason.METHOD, 0);
        }
        return _submit(target, value, data, bytes32(0), true);
    }

    /// @notice Executes a pending request under current rules, bypassing only the human threshold.
    /// @dev A policy block leaves the request pending for retry/reject. Call failure reverts all effects.
    function approve(uint256 id) external nonReentrant onlyOwner returns (Decision, Reason) {
        Request storage r = requests[id];
        if (r.status != Status.PENDING) revert NotPending();
        bytes memory data = r.data;
        (Decision decision, Reason reason) = _check(r.target, r.amount, bytes4(data), r.isExecute, true);
        bytes32 payloadHash = r.isExecute ? keccak256(data) : r.memoHash;
        if (decision == Decision.BLOCK) {
            emit Blocked(msg.sender, r.target, r.amount, reason, payloadHash, id);
            return (decision, reason);
        }
        r.status = Status.APPROVED;
        emit Approved(id);
        _spend(r.target, r.amount, data, r.isExecute, payloadHash, id);
        return (Decision.ALLOW, Reason.POLICY_PASSED);
    }

    function reject(uint256 id) external nonReentrant onlyOwner {
        if (requests[id].status != Status.PENDING) revert NotPending();
        requests[id].status = Status.REJECTED;
        emit Rejected(id);
    }

    function _check(address to, uint256 amount, bytes4 selector, bool isExecute, bool approved)
        private
        view
        returns (Decision, Reason)
    {
        Reason reason = Reason.POLICY_PASSED;
        uint256 spent = spentToday();
        int256 local = int256(block.timestamp) + int256(policy.utcOffsetMinutes) * 60;
        uint256 minute = uint256(local - currentDay() * 1 days) / 60;
        uint256 start = policy.activeStartMinute;
        uint256 end = policy.activeEndMinute;
        bool inHours = start == end || (start < end ? minute >= start && minute < end : minute >= start || minute < end);
        if (paused) reason = Reason.PAUSED;
        else if (!receivers[to]) reason = Reason.ALLOWLIST;
        else if (isExecute && selectorRestricted[to] && !selectors[to][selector]) reason = Reason.METHOD;
        else if (amount > policy.perTxCap) reason = Reason.PER_TX_CAP;
        else if (spent > policy.dailyCap || amount > policy.dailyCap - spent) reason = Reason.DAILY_CAP;
        else if (actionsLastHour() >= policy.maxActionsPerHour) reason = Reason.RATE_LIMIT;
        else if (!inHours) reason = Reason.ACTIVE_HOURS;
        else if (amount > address(this).balance) reason = Reason.INSUFFICIENT_BALANCE;
        if (reason != Reason.POLICY_PASSED) return (Decision.BLOCK, reason);
        if (!approved && amount > policy.askAboveAmount) return (Decision.ASK_HUMAN, Reason.NEEDS_APPROVAL);
        return (Decision.ALLOW, Reason.POLICY_PASSED);
    }

    function _submit(address to, uint256 amount, bytes memory data, bytes32 memoHash, bool isExecute)
        private
        returns (Decision, Reason, uint256)
    {
        (Decision decision, Reason reason) = _check(to, amount, bytes4(data), isExecute, false);
        bytes32 payloadHash = isExecute ? keccak256(data) : memoHash;
        if (decision == Decision.BLOCK) {
            emit Blocked(msg.sender, to, amount, reason, payloadHash, 0);
            return (decision, reason, 0);
        }
        if (decision == Decision.ASK_HUMAN) {
            uint256 id = nextRequestId++;
            requests[id] = Request(to, amount, data, memoHash, isExecute, Status.PENDING);
            emit Requested(id, to, amount, isExecute, data, memoHash);
            return (decision, reason, id);
        }
        _spend(to, amount, data, isExecute, payloadHash, 0);
        return (decision, reason, 0);
    }

    function _spend(address to, uint256 amount, bytes memory data, bool isExecute, bytes32 payloadHash, uint256 id)
        private
    {
        spentByDay[currentDay()] += amount;
        actionTimes.push(block.timestamp);
        emit Spent(to, amount, isExecute, payloadHash, id);
        (bool ok,) = to.call{value: amount}(data);
        if (!ok) revert CallFailed();
    }
}

