// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LeashVault} from "../src/LeashVault.sol";

/// @dev Rejects all ETH.
contract Rejector {
    receive() external payable {
        revert("no");
    }
}

/// @dev Tries to re-enter pay() from receive().
contract Reenterer {
    LeashVault public vault;
    constructor(LeashVault v) {
        vault = v;
    }

    receive() external payable {
        vault.pay(address(this), 1, bytes32(0));
    }
}

contract LeashVaultTest is Test {
    LeashVault vault;
    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address receiver = makeAddr("receiver");
    address stranger = makeAddr("stranger");

    uint256 constant DAY = 86400;
    // Local midnight boundary for offset +330: timestamp where local time is exactly midnight.
    uint256 constant T_IST_MIDNIGHT = 844200; // 1970-01-10 04:30:00 UTC == 10:00... day 10 boundary at +330

    function setUp() public {
        vm.warp(1_000_000);
        vault = new LeashVault(owner, agent);
        vm.startPrank(owner);
        vault.setPolicy(
            agent,
            LeashVault.Policy({
                dailyCap: 1 ether,
                perTxCap: 0.5 ether,
                askAboveAmount: 0.3 ether,
                maxActionsPerHour: 5,
                activeStartMinute: 0,
                activeEndMinute: 0,
                utcOffsetMinutes: 330
            })
        );
        vault.setReceiver(receiver, true);
        vm.stopPrank();
        vm.deal(owner, 100 ether);
        vm.prank(owner);
        (bool ok,) = address(vault).call{value: 10 ether}("");
        require(ok, "funding failed");
    }

    function _policy(
        uint256 dailyCap,
        uint256 perTxCap,
        uint256 askAbove,
        uint32 rate,
        uint16 start,
        uint16 end,
        int16 offset
    ) internal pure returns (LeashVault.Policy memory) {
        return LeashVault.Policy({
            dailyCap: dailyCap,
            perTxCap: perTxCap,
            askAboveAmount: askAbove,
            maxActionsPerHour: rate,
            activeStartMinute: start,
            activeEndMinute: end,
            utcOffsetMinutes: offset
        });
    }

    function _pay(uint256 amount) internal returns (LeashVault.Decision, LeashVault.Reason, uint256) {
        vm.prank(agent);
        return vault.pay(receiver, amount, bytes32(0));
    }

    // 1. Deployment defaults: deny-all, owner/agent wired, zero caps deny spending.
    function testDeploymentDefaults() public {
        LeashVault v = new LeashVault(owner, agent);
        assertEq(v.owner(), owner);
        assertEq(v.agent(), agent);
        assertEq(v.nextRequestId(), 1);
        (LeashVault.Decision d, LeashVault.Reason r) = v.check(receiver, 0, bytes4(0));
        assertEq(uint256(d), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r), uint256(LeashVault.Reason.ALLOWLIST)); // no receivers set
        vm.prank(owner);
        v.setReceiver(receiver, true);
        // Zero caps deny any positive amount (per-tx cap is the first rule hit).
        (d, r) = v.check(receiver, 1, bytes4(0));
        assertEq(uint256(d), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r), uint256(LeashVault.Reason.PER_TX_CAP));
    }

    // 2. Deployment overrides: constructor funding emits Deposited and holds balance.
    function testDeploymentOverrides() public {
        vm.deal(address(this), 5 ether);
        vm.expectEmit(false, false, false, true);
        emit LeashVault.Deposited(2 ether);
        LeashVault v = new LeashVault{value: 2 ether}(owner, agent);
        assertEq(address(v).balance, 2 ether);
    }

    // 3. Constructor rejects zero addresses.
    function testConstructorRejectsZeroAddresses() public {
        vm.expectRevert(LeashVault.InvalidAddress.selector);
        new LeashVault(address(0), agent);
        vm.expectRevert(LeashVault.InvalidAddress.selector);
        new LeashVault(owner, address(0));
    }

    // 4. onlyOwner on every administrative function and plain deposits.
    function testOnlyOwner() public {
        vm.startPrank(stranger);
        vm.expectRevert(LeashVault.OnlyOwner.selector);
        vault.setPolicy(agent, _policy(1 ether, 1 ether, 0, 5, 0, 0, 0));
        vm.expectRevert(LeashVault.OnlyOwner.selector);
        vault.setReceiver(receiver, true);
        vm.expectRevert(LeashVault.OnlyOwner.selector);
        vault.setSelector(receiver, bytes4(0x12345678), true);
        vm.expectRevert(LeashVault.OnlyOwner.selector);
        vault.pause();
        vm.expectRevert(LeashVault.OnlyOwner.selector);
        vault.unpause();
        vm.expectRevert(LeashVault.OnlyOwner.selector);
        vault.withdraw(payable(stranger), 1);
        vm.expectRevert(LeashVault.OnlyOwner.selector);
        vault.approve(1);
        vm.expectRevert(LeashVault.OnlyOwner.selector);
        vault.reject(1);
        vm.deal(stranger, 1 ether);
        vm.expectRevert(LeashVault.OnlyOwner.selector);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        ok; // silence warning; the revert above is the assertion
        vm.stopPrank();
    }

    // 5. onlyAgent on pay/execute.
    function testOnlyAgent() public {
        vm.prank(stranger);
        vm.expectRevert(LeashVault.OnlyAgent.selector);
        vault.pay(receiver, 0.1 ether, bytes32(0));
        vm.prank(stranger);
        vm.expectRevert(LeashVault.OnlyAgent.selector);
        vault.execute(receiver, 0, hex"deadbeef");
    }

    // 6. ALLOW happy path: events, ETH moves, spend and action history recorded.
    function testAllowPay() public {
        uint256 before = receiver.balance;
        vm.expectEmit(true, true, false, true, address(vault));
        emit LeashVault.Spent(receiver, 0.2 ether, false, bytes32(0), 0);
        (LeashVault.Decision d, LeashVault.Reason r, uint256 id) = _pay(0.2 ether);
        assertEq(uint256(d), uint256(LeashVault.Decision.ALLOW));
        assertEq(uint256(r), uint256(LeashVault.Reason.POLICY_PASSED));
        assertEq(id, 0);
        assertEq(receiver.balance, before + 0.2 ether);
        assertEq(vault.spentToday(), 0.2 ether);
        assertEq(vault.actionsLastHour(), 1);
    }

    // 7. ALLOWLIST block for unset receiver, with Blocked event.
    function testBlockAllowlist() public {
        vm.expectEmit(true, true, false, true, address(vault));
        emit LeashVault.Blocked(agent, stranger, 0.1 ether, LeashVault.Reason.ALLOWLIST, bytes32(0), 0);
        vm.prank(agent);
        (LeashVault.Decision d, LeashVault.Reason r,) = vault.pay(stranger, 0.1 ether, bytes32(0));
        assertEq(uint256(d), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r), uint256(LeashVault.Reason.ALLOWLIST));
    }

    // 8. PER_TX_CAP block above per-transaction cap.
    function testBlockPerTxCap() public {
        (LeashVault.Decision d, LeashVault.Reason r,) = _pay(0.5 ether + 1);
        assertEq(uint256(d), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r), uint256(LeashVault.Reason.PER_TX_CAP));
    }

    // 9. DAILY_CAP block when the amount alone exceeds the remaining cap.
    function testBlockDailyCapAmount() public {
        vm.prank(owner);
        vault.setPolicy(agent, _policy(1 ether, 10 ether, type(uint256).max, 50, 0, 0, 330));
        (LeashVault.Decision d, LeashVault.Reason r,) = _pay(1 ether + 1);
        assertEq(uint256(d), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r), uint256(LeashVault.Reason.DAILY_CAP));
    }

    // 10. DAILY_CAP block on cumulative spend within the same offset day.
    function testBlockDailyCapAfterSpent() public {
        vm.prank(owner);
        vault.setPolicy(agent, _policy(1 ether, 10 ether, type(uint256).max, 50, 0, 0, 330));
        _pay(0.4 ether);
        _pay(0.4 ether);
        (LeashVault.Decision d, LeashVault.Reason r,) = _pay(0.3 ether); // 1.1 > 1.0 cap
        assertEq(uint256(d), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r), uint256(LeashVault.Reason.DAILY_CAP));
        assertEq(vault.spentToday(), 0.8 ether);
    }

    // 11. Day rollover follows the +330 offset, not UTC: spend resets at local midnight.
    function testDayRolloverUsesOffset() public {
        vm.prank(owner);
        vault.setPolicy(agent, _policy(1 ether, 10 ether, type(uint256).max, 50, 0, 0, 330));
        vm.warp(T_IST_MIDNIGHT - 60); // one minute before local midnight
        assertEq(vault.currentDay(), int256((int256(uint256(T_IST_MIDNIGHT - 60)) + 330 * 60) / int256(DAY)));
        (LeashVault.Decision d,,) = _pay(0.9 ether);
        assertEq(uint256(d), uint256(LeashVault.Decision.ALLOW));
        // Same UTC hour, but one minute later the IST day has flipped.
        vm.warp(T_IST_MIDNIGHT + 60);
        assertEq(vault.spentToday(), 0);
        (d,,) = _pay(0.9 ether);
        assertEq(uint256(d), uint256(LeashVault.Decision.ALLOW));
        assertEq(vault.spentToday(), 0.9 ether);
    }

    // 12. Active hours, normal window (start < end).
    function testActiveHoursNormal() public {
        // Local time at warp: (1_000_000 + 19800) % 86400 / 60 = local minute.
        uint256 localMinute = ((1_000_000 + 19_800) % DAY) / 60;
        uint16 start = uint16((localMinute + 60) % 1440);
        uint16 end = uint16((localMinute + 120) % 1440);
        vm.prank(owner);
        vault.setPolicy(agent, _policy(1 ether, 1 ether, type(uint256).max, 50, start, end, 330));
        (LeashVault.Decision d, LeashVault.Reason r,) = _pay(0.1 ether);
        assertEq(uint256(d), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r), uint256(LeashVault.Reason.ACTIVE_HOURS));
        vm.warp(block.timestamp + 61 minutes);
        (d,,) = _pay(0.1 ether);
        assertEq(uint256(d), uint256(LeashVault.Decision.ALLOW));
    }

    // 13. Active hours, overnight window (start > end wraps midnight).
    function testActiveHoursOvernight() public {
        uint256 localMinute = ((1_000_000 + 19_800) % DAY) / 60;
        uint16 start = uint16((localMinute + 1380) % 1440); // starts 23h from now, i.e. covers now when wrapping
        uint16 end = uint16((localMinute + 60) % 1440);
        vm.prank(owner);
        vault.setPolicy(agent, _policy(1 ether, 1 ether, type(uint256).max, 50, start, end, 330));
        (LeashVault.Decision d,,) = _pay(0.1 ether);
        assertEq(uint256(d), uint256(LeashVault.Decision.ALLOW)); // inside the wrapped window
        vm.warp(block.timestamp + 61 minutes); // now past end
        (LeashVault.Decision d2, LeashVault.Reason r2,) = _pay(0.1 ether);
        assertEq(uint256(d2), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r2), uint256(LeashVault.Reason.ACTIVE_HOURS));
    }

    // 14. Equal start/end means all hours are allowed.
    function testActiveHoursEqualAllDay() public {
        vm.prank(owner);
        vault.setPolicy(agent, _policy(1 ether, 1 ether, type(uint256).max, 50, 700, 700, 330));
        (LeashVault.Decision d,,) = _pay(0.1 ether);
        assertEq(uint256(d), uint256(LeashVault.Decision.ALLOW));
    }

    // 15. RATE_LIMIT blocks the (max+1)-th action inside an hour.
    function testRateLimit() public {
        for (uint256 i; i < 5; i++) {
            (LeashVault.Decision d,,) = _pay(0.1 ether);
            assertEq(uint256(d), uint256(LeashVault.Decision.ALLOW));
        }
        (LeashVault.Decision d, LeashVault.Reason r,) = _pay(0.1 ether);
        assertEq(uint256(d), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r), uint256(LeashVault.Reason.RATE_LIMIT));
    }

    // 16. Rolling-hour expiry frees slots exactly one hour later.
    function testRateLimitRollingExpiry() public {
        for (uint256 i; i < 5; i++) _pay(0.1 ether);
        assertEq(vault.actionsLastHour(), 5);
        vm.warp(block.timestamp + 1 hours + 1);
        assertEq(vault.actionsLastHour(), 0);
        (LeashVault.Decision d,,) = _pay(0.1 ether);
        assertEq(uint256(d), uint256(LeashVault.Decision.ALLOW));
        // Mixed old/new: two more now, then only the newest three survive the next rollover.
        _pay(0.1 ether);
        vm.warp(block.timestamp + 30 minutes);
        _pay(0.1 ether);
        assertEq(vault.actionsLastHour(), 3);
        vm.warp(block.timestamp + 31 minutes);
        assertEq(vault.actionsLastHour(), 1);
    }

    // 17. PAUSED blocks agent spend, owner recovery still works, unpause restores.
    function testPausedBlocksPayButOwnerRecovers() public {
        vm.prank(owner);
        vault.pause();
        (LeashVault.Decision d, LeashVault.Reason r,) = _pay(0.1 ether);
        assertEq(uint256(d), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r), uint256(LeashVault.Reason.PAUSED));
        uint256 before = owner.balance;
        vm.prank(owner);
        vault.withdraw(payable(owner), 1 ether);
        assertEq(owner.balance, before + 1 ether);
        vm.prank(owner);
        vault.unpause();
        (d,,) = _pay(0.1 ether);
        assertEq(uint256(d), uint256(LeashVault.Decision.ALLOW));
    }

    // 18. Above the human threshold the request queues instead of paying.
    function testAskHumanQueues() public {
        vm.expectEmit(true, true, false, true, address(vault));
        emit LeashVault.Requested(1, receiver, 0.4 ether, false, "", bytes32(0));
        (LeashVault.Decision d, LeashVault.Reason r, uint256 id) = _pay(0.4 ether);
        assertEq(uint256(d), uint256(LeashVault.Decision.ASK_HUMAN));
        assertEq(uint256(r), uint256(LeashVault.Reason.NEEDS_APPROVAL));
        assertEq(id, 1);
        LeashVault.Request memory req = vault.getRequest(1);
        assertEq(req.target, receiver);
        assertEq(req.amount, 0.4 ether);
        assertEq(uint256(req.status), uint256(LeashVault.Status.PENDING));
        assertEq(vault.spentToday(), 0);
        assertEq(vault.nextRequestId(), 2);
    }

    // 19. Approval executes under current rules, bypassing only the human threshold.
    function testApproveSpends() public {
        (,, uint256 id) = _pay(0.4 ether);
        vm.expectEmit(true, false, false, false, address(vault));
        emit LeashVault.Approved(id);
        vm.prank(owner);
        (LeashVault.Decision d, LeashVault.Reason r) = vault.approve(id);
        assertEq(uint256(d), uint256(LeashVault.Decision.ALLOW));
        assertEq(uint256(r), uint256(LeashVault.Reason.POLICY_PASSED));
        assertEq(uint256(vault.getRequest(id).status), uint256(LeashVault.Status.APPROVED));
        assertEq(vault.spentToday(), 0.4 ether);
        // But a rule violation still blocks: queue another, then tighten policy below it.
        (,, uint256 id2) = _pay(0.4 ether);
        vm.prank(owner);
        vault.setPolicy(agent, _policy(0.3 ether, 1 ether, 0, 50, 0, 0, 330));
        vm.prank(owner);
        (LeashVault.Decision d2, LeashVault.Reason r2) = vault.approve(id2);
        assertEq(uint256(d2), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r2), uint256(LeashVault.Reason.DAILY_CAP));
    }

    // 20. A policy-blocked approval leaves the request pending for later retry.
    function testApprovePolicyBlockLeavesPending() public {
        (,, uint256 id) = _pay(0.4 ether);
        vm.prank(owner);
        vault.pause();
        vm.prank(owner);
        (LeashVault.Decision d, LeashVault.Reason r) = vault.approve(id);
        assertEq(uint256(d), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r), uint256(LeashVault.Reason.PAUSED));
        assertEq(uint256(vault.getRequest(id).status), uint256(LeashVault.Status.PENDING));
        vm.prank(owner);
        vault.unpause();
        vm.prank(owner);
        (LeashVault.Decision d2,) = vault.approve(id);
        assertEq(uint256(d2), uint256(LeashVault.Decision.ALLOW));
    }

    // 21. Reject flow: status flips, later approve/reject revert NotPending.
    function testRejectFlow() public {
        (,, uint256 id) = _pay(0.4 ether);
        vm.prank(owner);
        vault.reject(id);
        assertEq(uint256(vault.getRequest(id).status), uint256(LeashVault.Status.REJECTED));
        vm.prank(owner);
        vm.expectRevert(LeashVault.NotPending.selector);
        vault.approve(id);
        vm.prank(owner);
        vm.expectRevert(LeashVault.NotPending.selector);
        vault.reject(id);
    }

    // 22. INSUFFICIENT_BALANCE blocks spends above the vault balance.
    function testInsufficientBalance() public {
        vm.prank(owner);
        vault.withdraw(payable(owner), 9.9 ether);
        assertEq(address(vault).balance, 0.1 ether);
        vm.prank(owner);
        vault.setPolicy(agent, _policy(1 ether, 1 ether, type(uint256).max, 50, 0, 0, 330));
        (LeashVault.Decision d, LeashVault.Reason r,) = _pay(0.2 ether);
        assertEq(uint256(d), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r), uint256(LeashVault.Reason.INSUFFICIENT_BALANCE));
    }

    // 23. Selector restrictions: untouched receiver permits all; restriction then filters; removing the last selector denies all.
    function testSelectorRestrictions() public {
        bytes4 allowed = bytes4(0xa9059cbb);
        bytes4 denied = bytes4(0xdeadbeef);
        // Untouched receiver: any selector passes the METHOD rule.
        (LeashVault.Decision d,) = vault.checkExecute(receiver, 0, abi.encodeWithSelector(denied));
        assertEq(uint256(d), uint256(LeashVault.Decision.ALLOW));
        vm.startPrank(owner);
        vault.setSelector(receiver, allowed, true);
        vm.stopPrank();
        (d,) = vault.checkExecute(receiver, 0, abi.encodeWithSelector(allowed));
        assertEq(uint256(d), uint256(LeashVault.Decision.ALLOW));
        (LeashVault.Decision d2, LeashVault.Reason r2) = vault.checkExecute(receiver, 0, abi.encodeWithSelector(denied));
        assertEq(uint256(d2), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r2), uint256(LeashVault.Reason.METHOD));
        // Removing the only selector leaves the restriction active -> all denied.
        vm.prank(owner);
        vault.setSelector(receiver, allowed, false);
        (LeashVault.Decision d3, LeashVault.Reason r3) = vault.checkExecute(receiver, 0, abi.encodeWithSelector(allowed));
        assertEq(uint256(d3), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r3), uint256(LeashVault.Reason.METHOD));
        // Execute carries value through when allowed.
        vm.prank(owner);
        vault.setSelector(receiver, allowed, true);
        vm.prank(agent);
        (LeashVault.Decision d4,,) = vault.execute(receiver, 0.1 ether, abi.encodeWithSelector(allowed));
        assertEq(uint256(d4), uint256(LeashVault.Decision.ALLOW));
    }

    // 24. Malformed calldata (<4 bytes) blocks as METHOD, in both preview and execute.
    function testExecuteShortCalldata() public {
        (LeashVault.Decision d, LeashVault.Reason r) = vault.checkExecute(receiver, 0, hex"0102");
        assertEq(uint256(d), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r), uint256(LeashVault.Reason.METHOD));
        vm.prank(agent);
        (LeashVault.Decision d2, LeashVault.Reason r2, uint256 id) = vault.execute(receiver, 0, hex"0102");
        assertEq(uint256(d2), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r2), uint256(LeashVault.Reason.METHOD));
        assertEq(id, 0);
    }

    // 25. check() preview is read-only and mirrors pay/execute decisions.
    function testCheckPreviewReadOnly() public {
        (LeashVault.Decision d, LeashVault.Reason r) = vault.check(receiver, 0.2 ether, bytes4(0));
        assertEq(uint256(d), uint256(LeashVault.Decision.ALLOW));
        assertEq(uint256(r), uint256(LeashVault.Reason.POLICY_PASSED));
        (d, r) = vault.check(receiver, 0.4 ether, bytes4(0));
        assertEq(uint256(d), uint256(LeashVault.Decision.ASK_HUMAN));
        assertEq(uint256(r), uint256(LeashVault.Reason.NEEDS_APPROVAL));
        (d, r) = vault.check(stranger, 0.1 ether, bytes4(0));
        assertEq(uint256(r), uint256(LeashVault.Reason.ALLOWLIST));
        assertEq(vault.spentToday(), 0);
        assertEq(vault.actionsLastHour(), 0);
        assertEq(vault.nextRequestId(), 1);
    }

    // 26. A failing recipient reverts the whole call: no spend or action history survives.
    function testRecipientFailureRevertsAll() public {
        Rejector rej = new Rejector();
        vm.prank(owner);
        vault.setReceiver(address(rej), true);
        vm.prank(agent);
        vm.expectRevert(LeashVault.CallFailed.selector);
        vault.pay(address(rej), 0.1 ether, bytes32(0));
        assertEq(vault.spentToday(), 0);
        assertEq(vault.actionsLastHour(), 0);
        assertEq(address(vault).balance, 10 ether);
    }

    // 27. Reentrant recipients cannot double-spend; the outer call reverts with nothing spent.
    function testReentrancyBlocked() public {
        Reenterer att = new Reenterer(vault);
        vm.prank(owner);
        vault.setReceiver(address(att), true);
        vm.prank(agent);
        vm.expectRevert(LeashVault.CallFailed.selector);
        vault.pay(address(att), 0.1 ether, bytes32(0));
        assertEq(vault.spentToday(), 0);
        assertEq(address(vault).balance, 10 ether);
        assertEq(address(att).balance, 0);
    }

    // 28. Withdraw rules: owner-only, no zero address, failure surfaces CallFailed.
    function testWithdrawRules() public {
        vm.prank(owner);
        vm.expectRevert(LeashVault.InvalidAddress.selector);
        vault.withdraw(payable(address(0)), 1 ether);
        Rejector rej = new Rejector();
        vm.prank(owner);
        vm.expectRevert(LeashVault.CallFailed.selector);
        vault.withdraw(payable(address(rej)), 1 ether);
        uint256 before = owner.balance;
        vm.prank(owner);
        vault.withdraw(payable(owner), 3 ether);
        assertEq(owner.balance, before + 3 ether);
        assertEq(address(vault).balance, 7 ether);
    }

    // 29. Fuzz (256 runs): successful payments and approvals never exceed the daily cap across day rollover.
    function testFuzz_dailyCapAcrossRollover(
        uint64 capSeed,
        uint64[6] memory amounts,
        uint32[6] memory warps,
        bool approvePath
    ) public {
        uint256 dailyCap = bound(capSeed, 1, 5 ether);
        vm.prank(owner);
        vault.setPolicy(agent, _policy(dailyCap, type(uint256).max, approvePath ? 0 : type(uint256).max, 255, 0, 0, 330));
        vm.deal(owner, 1000 ether);
        vm.prank(owner);
        (bool ok,) = address(vault).call{value: 200 ether}("");
        require(ok);
        for (uint256 i; i < 6; i++) {
            vm.warp(block.timestamp + bound(warps[i], 0, 2 days));
            uint256 amt = bound(amounts[i], 0, 8 ether);
            vm.prank(agent);
            (LeashVault.Decision d,, uint256 id) = vault.pay(receiver, amt, bytes32(0));
            if (d == LeashVault.Decision.ASK_HUMAN) {
                vm.prank(owner);
                vault.approve(id); // may stay pending on a policy block; cap invariant must hold either way
            }
            assertLe(vault.spentByDay(vault.currentDay()), dailyCap, "daily cap exceeded");
        }
        // Conservation: everything that left the vault (10 ether from setUp + 200 ether here) is at the receiver.
        assertEq(receiver.balance, 210 ether - address(vault).balance, "vault accounting leak");
    }
}
