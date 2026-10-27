// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LeashVault} from "../src/LeashVault.sol";
import {Deploy} from "../script/Deploy.s.sol";

contract Coffee {
    uint256 public brewed;
    bool public drained;

    function brew(uint256 cups) external payable {
        brewed += cups;
    }

    function drain() external {
        drained = true;
    }

    receive() external payable {}

    fallback() external payable {
        drained = true;
    }
}

contract FailingReceiver {
    receive() external payable {
        revert("no thanks");
    }
}

contract ReentrantAgent {
    LeashVault public vault;
    bytes4 public failure;
    uint256 public observedSpent;
    uint256 public observedActions;

    constructor(LeashVault vault_) {
        vault = vault_;
    }

    function attack() external {
        vault.pay(address(this), 0.1 ether, 0);
    }

    receive() external payable {
        observedSpent = vault.spentToday();
        observedActions = vault.actionsLastHour();
        try vault.pay(address(this), 0.1 ether, 0) {}
        catch (bytes memory reason) {
            failure = bytes4(reason);
        }
    }
}

contract LeashVaultTest is Test {
    LeashVault vault;
    LeashVault.Policy p;
    address agent = makeAddr("agent");
    address receiver = makeAddr("receiver");
    bytes32 constant MEMO = keccak256("coffee");

    function setUp() public {
        vm.warp(10 days + 4 hours + 30 minutes); // 10:00 IST
        vm.deal(address(this), 100 ether);
        vault = new LeashVault{value: 10 ether}(address(this), agent);
        p = LeashVault.Policy(2 ether, 0.5 ether, 0.3 ether, 5, 0, 0, 330);
        vault.setPolicy(agent, p);
        vault.setReceiver(receiver, true);
    }

    function pay(uint256 amount) internal returns (LeashVault.Decision, LeashVault.Reason, uint256) {
        vm.prank(agent);
        return vault.pay(receiver, amount, MEMO);
    }

    function expectCheck(uint256 amount, LeashVault.Decision decision, LeashVault.Reason reason) internal view {
        (LeashVault.Decision d, LeashVault.Reason r) = vault.check(receiver, amount, 0);
        assertEq(uint256(d), uint256(decision));
        assertEq(uint256(r), uint256(reason));
    }

    function testAllowThresholdEqualityAndAccounting() public {
        expectCheck(0.3 ether, LeashVault.Decision.ALLOW, LeashVault.Reason.POLICY_PASSED);
        vm.expectEmit(true, false, false, true, address(vault));
        emit LeashVault.Spent(receiver, 0.3 ether, false, MEMO, 0);
        (LeashVault.Decision d,, uint256 id) = pay(0.3 ether);
        assertEq(uint256(d), uint256(LeashVault.Decision.ALLOW));
        assertEq(id, 0);
        assertEq(receiver.balance, 0.3 ether);
        assertEq(vault.spentToday(), 0.3 ether);
        assertEq(vault.actionsLastHour(), 1);
        assertEq(address(vault).balance, 9.7 ether);
    }

    function testBlockPerTxEmitsWithoutRevertingOrMovingFunds() public {
        vm.expectEmit(true, true, false, true, address(vault));
        emit LeashVault.Blocked(agent, receiver, 0.6 ether, LeashVault.Reason.PER_TX_CAP, MEMO, 0);
        (LeashVault.Decision d, LeashVault.Reason r, uint256 id) = pay(0.6 ether);
        assertEq(uint256(d), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r), uint256(LeashVault.Reason.PER_TX_CAP));
        assertEq(id, 0);
        assertEq(vault.nextRequestId(), 1);
        assertEq(vault.spentToday(), 0);
        assertEq(vault.actionsLastHour(), 0);
        assertEq(receiver.balance, 0);
    }

    function testDailyCapAndCapEquality() public {
        p.dailyCap = 0.5 ether;
        vault.setPolicy(agent, p);
        pay(0.3 ether);
        pay(0.2 ether);
        expectCheck(1, LeashVault.Decision.BLOCK, LeashVault.Reason.DAILY_CAP);
        assertEq(vault.spentToday(), p.dailyCap);
    }

    function testLoweringCapBelowSpendDoesNotUnderflowOrReset() public {
        pay(0.2 ether);
        p.dailyCap = 0.1 ether;
        vault.setPolicy(agent, p);
        expectCheck(type(uint256).max, LeashVault.Decision.BLOCK, LeashVault.Reason.PER_TX_CAP);
        expectCheck(0, LeashVault.Decision.BLOCK, LeashVault.Reason.DAILY_CAP);
        assertEq(vault.spentToday(), 0.2 ether);
        assertEq(vault.actionsLastHour(), 1);
    }

    function testExactAllowlistAndRevocation() public {
        vm.prank(agent);
        (LeashVault.Decision d, LeashVault.Reason r,) = vault.pay(address(uint160(receiver) + 1), 1, 0);
        assertEq(uint256(d), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r), uint256(LeashVault.Reason.ALLOWLIST));
        vault.setReceiver(receiver, false);
        expectCheck(0.1 ether, LeashVault.Decision.BLOCK, LeashVault.Reason.ALLOWLIST);
    }

    function testRollingHourNotClockBucketAndExactExpiry() public {
        uint256 start = vm.getBlockTimestamp();
        for (uint256 i; i < 5; ++i) {
            pay(0.01 ether);
        }
        expectCheck(0, LeashVault.Decision.BLOCK, LeashVault.Reason.RATE_LIMIT);
        vm.warp(start + 3599);
        expectCheck(0, LeashVault.Decision.BLOCK, LeashVault.Reason.RATE_LIMIT);
        vm.warp(start + 3600);
        assertEq(vault.actionsLastHour(), 0);
        pay(0.01 ether);
        assertEq(vault.actionsLastHour(), 1);
    }

    function testRollingHourPartialExpiry() public {
        uint256 start = vm.getBlockTimestamp();
        pay(0);
        vm.warp(start + 100);
        pay(0);
        vm.warp(start + 3600);
        assertEq(vault.actionsLastHour(), 1);
    }

    function testZeroRateDeniesAllActions() public {
        p.maxActionsPerHour = 0;
        vault.setPolicy(agent, p);
        expectCheck(0, LeashVault.Decision.BLOCK, LeashVault.Reason.RATE_LIMIT);
    }

    function testDailyRolloverAtMidnightIST() public {
        vm.warp(10 days + 18 hours + 29 minutes + 59);
        pay(0.2 ether);
        assertEq(vault.currentDay(), 10);
        vm.warp(vm.getBlockTimestamp() + 1);
        assertEq(vault.currentDay(), 11);
        assertEq(vault.spentToday(), 0);
        assertEq(vault.spentByDay(10), 0.2 ether);
        assertEq(vault.actionsLastHour(), 1); // Daily reset must not reset rolling hour.
    }

    function testActiveHoursISTBoundaries() public {
        p.activeStartMinute = 540;
        p.activeEndMinute = 1260;
        vault.setPolicy(agent, p);
        vm.warp(10 days + 3 hours + 29 minutes + 59);
        expectCheck(0, LeashVault.Decision.BLOCK, LeashVault.Reason.ACTIVE_HOURS);
        vm.warp(vm.getBlockTimestamp() + 1);
        expectCheck(0, LeashVault.Decision.ALLOW, LeashVault.Reason.POLICY_PASSED);
        vm.warp(10 days + 15 hours + 29 minutes + 59);
        expectCheck(0, LeashVault.Decision.ALLOW, LeashVault.Reason.POLICY_PASSED);
        vm.warp(vm.getBlockTimestamp() + 1);
        expectCheck(0, LeashVault.Decision.BLOCK, LeashVault.Reason.ACTIVE_HOURS);
    }

    function testOvernightHoursAndNegativeOffset() public {
        p.activeStartMinute = 1260;
        p.activeEndMinute = 540;
        p.utcOffsetMinutes = -300;
        vault.setPolicy(agent, p);
        vm.warp(10 days + 5 hours); // Midnight UTC-5.
        expectCheck(0, LeashVault.Decision.ALLOW, LeashVault.Reason.POLICY_PASSED);
        vm.warp(10 days + 14 hours); // 09:00, exclusive end.
        expectCheck(0, LeashVault.Decision.BLOCK, LeashVault.Reason.ACTIVE_HOURS);
        vm.warp(0); // Signed day buckets also work before local epoch.
        assertEq(vault.currentDay(), -1);
    }

    function testFullDayDefaultAllowsNight() public {
        vm.warp(10 days + 17 hours + 30 minutes);
        expectCheck(0, LeashVault.Decision.ALLOW, LeashVault.Reason.POLICY_PASSED);
    }

    function testAskApproveOnceAndReject() public {
        expectCheck(0.4 ether, LeashVault.Decision.ASK_HUMAN, LeashVault.Reason.NEEDS_APPROVAL);
        (LeashVault.Decision d, LeashVault.Reason r, uint256 id) = pay(0.4 ether);
        assertEq(uint256(d), uint256(LeashVault.Decision.ASK_HUMAN));
        assertEq(uint256(r), uint256(LeashVault.Reason.NEEDS_APPROVAL));
        assertEq(id, 1);
        assertEq(vault.spentToday(), 0);
        assertEq(vault.actionsLastHour(), 0);
        assertEq(receiver.balance, 0);
        assertEq(vault.getRequest(id).memoHash, MEMO);
        (d, r) = vault.approve(id);
        assertEq(uint256(d), uint256(LeashVault.Decision.ALLOW));
        assertEq(uint256(r), uint256(LeashVault.Reason.POLICY_PASSED));
        assertEq(receiver.balance, 0.4 ether);
        assertEq(vault.spentToday(), 0.4 ether);
        assertEq(vault.actionsLastHour(), 1);
        assertEq(uint256(vault.getRequest(id).status), uint256(LeashVault.Status.APPROVED));
        vm.expectRevert(LeashVault.NotPending.selector);
        vault.approve(id);
        (,, id) = pay(0.4 ether);
        vault.reject(id);
        assertEq(uint256(vault.getRequest(id).status), uint256(LeashVault.Status.REJECTED));
        assertEq(receiver.balance, 0.4 ether);
        vm.expectRevert(LeashVault.NotPending.selector);
        vault.approve(id);
        vm.expectRevert(LeashVault.NotPending.selector);
        vault.reject(id);
        vm.expectRevert(LeashVault.NotPending.selector);
        vault.approve(999);
    }

    function testApprovalRechecksDailyBudgetAndCanRetryNextDay() public {
        p.dailyCap = 0.5 ether;
        vault.setPolicy(agent, p);
        (,, uint256 id) = pay(0.4 ether);
        pay(0.2 ether);
        (LeashVault.Decision d, LeashVault.Reason r) = vault.approve(id);
        assertEq(uint256(d), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r), uint256(LeashVault.Reason.DAILY_CAP));
        assertEq(uint256(vault.getRequest(id).status), uint256(LeashVault.Status.PENDING));
        vm.warp(vm.getBlockTimestamp() + 1 days);
        vault.approve(id);
        assertEq(vault.spentToday(), 0.4 ether);
    }

    function testApprovalRechecksAllCurrentRestrictions() public {
        (,, uint256 id) = pay(0.4 ether);
        vault.pause();
        (, LeashVault.Reason r) = vault.approve(id);
        assertEq(uint256(r), uint256(LeashVault.Reason.PAUSED));
        vault.unpause();
        vault.setReceiver(receiver, false);
        (, r) = vault.approve(id);
        assertEq(uint256(r), uint256(LeashVault.Reason.ALLOWLIST));
        vault.setReceiver(receiver, true);
        p.perTxCap = 0.3 ether;
        vault.setPolicy(agent, p);
        (, r) = vault.approve(id);
        assertEq(uint256(r), uint256(LeashVault.Reason.PER_TX_CAP));
        p.perTxCap = 0.5 ether;
        p.maxActionsPerHour = 0;
        vault.setPolicy(agent, p);
        (, r) = vault.approve(id);
        assertEq(uint256(r), uint256(LeashVault.Reason.RATE_LIMIT));
        p.maxActionsPerHour = 5;
        p.activeStartMinute = 0;
        p.activeEndMinute = 1;
        vault.setPolicy(agent, p);
        (, r) = vault.approve(id);
        assertEq(uint256(r), uint256(LeashVault.Reason.ACTIVE_HOURS));
        p.activeEndMinute = 0;
        vault.setPolicy(agent, p);
        vault.withdraw(payable(receiver), 10 ether);
        (, r) = vault.approve(id);
        assertEq(uint256(r), uint256(LeashVault.Reason.INSUFFICIENT_BALANCE));
        assertEq(uint256(vault.getRequest(id).status), uint256(LeashVault.Status.PENDING));
    }

    function testSelectorBlocksLevelNineDrainAndAllowsBrew() public {
        Coffee coffee = new Coffee();
        vault.setReceiver(address(coffee), true);
        vault.setSelector(address(coffee), Coffee.brew.selector, true);
        vm.prank(agent);
        (LeashVault.Decision d, LeashVault.Reason r,) =
            vault.execute(address(coffee), 0, abi.encodeCall(Coffee.drain, ()));
        assertEq(uint256(d), uint256(LeashVault.Decision.BLOCK));
        assertEq(uint256(r), uint256(LeashVault.Reason.METHOD));
        assertFalse(coffee.drained());
        vm.prank(agent);
        vault.execute(address(coffee), 0.1 ether, abi.encodeCall(Coffee.brew, (2)));
        assertEq(coffee.brewed(), 2);
        assertEq(address(coffee).balance, 0.1 ether);
        assertEq(vault.spentToday(), 0.1 ether);
    }

    function testUnrestrictedReceiverAndDenyAllAfterSelectorRemoval() public {
        Coffee coffee = new Coffee();
        vault.setReceiver(address(coffee), true);
        vm.prank(agent);
        vault.execute(address(coffee), 0, abi.encodeCall(Coffee.brew, (1)));
        assertEq(coffee.brewed(), 1);
        vault.setSelector(address(coffee), Coffee.brew.selector, false);
        (, LeashVault.Reason r) = vault.check(address(coffee), 0, Coffee.brew.selector);
        assertEq(uint256(r), uint256(LeashVault.Reason.METHOD));
        // Selector restrictions apply only to execute, never to a plain payment.
        (LeashVault.Decision d,) = vault.check(address(coffee), 0, 0);
        assertEq(uint256(d), uint256(LeashVault.Decision.ALLOW));
    }

    function testZeroSelectorAndShortCalldataCannotBypassRestriction() public {
        Coffee coffee = new Coffee();
        vault.setReceiver(address(coffee), true);
        vault.setSelector(address(coffee), Coffee.brew.selector, true);
        vm.startPrank(agent);
        (, LeashVault.Reason r,) = vault.execute(address(coffee), 0, hex"00000000");
        assertEq(uint256(r), uint256(LeashVault.Reason.METHOD));
        (, r,) = vault.execute(address(coffee), 0, hex"010203");
        assertEq(uint256(r), uint256(LeashVault.Reason.METHOD));
        vm.stopPrank();
        (, r) = vault.checkExecute(address(coffee), 0, hex"00000000");
        assertEq(uint256(r), uint256(LeashVault.Reason.METHOD));
        (, r) = vault.checkExecute(address(coffee), 0, "");
        assertEq(uint256(r), uint256(LeashVault.Reason.METHOD));
        assertFalse(coffee.drained());
    }

    function testExecuteApprovalPreservesCalldataAndRechecksSelector() public {
        Coffee coffee = new Coffee();
        vault.setReceiver(address(coffee), true);
        vault.setSelector(address(coffee), Coffee.brew.selector, true);
        vm.prank(agent);
        (,, uint256 id) = vault.execute(address(coffee), 0.4 ether, abi.encodeCall(Coffee.brew, (7)));
        assertEq(vault.getRequest(id).data, abi.encodeCall(Coffee.brew, (7)));
        assertEq(coffee.brewed(), 0);
        vault.setSelector(address(coffee), Coffee.brew.selector, false);
        (, LeashVault.Reason r) = vault.approve(id);
        assertEq(uint256(r), uint256(LeashVault.Reason.METHOD));
        vault.setSelector(address(coffee), Coffee.brew.selector, true);
        vault.approve(id);
        assertEq(coffee.brewed(), 7);
        assertEq(address(coffee).balance, 0.4 ether);
    }

    function testPauseAndOwnerRecovery() public {
        vault.pause();
        expectCheck(0, LeashVault.Decision.BLOCK, LeashVault.Reason.PAUSED);
        pay(0.1 ether);
        assertEq(receiver.balance, 0);
        vault.withdraw(payable(receiver), 1 ether);
        assertEq(receiver.balance, 1 ether);
        assertEq(vault.spentToday(), 0);
        vault.unpause();
        pay(0.1 ether);
        assertEq(receiver.balance, 1.1 ether);
    }

    function testInsufficientBalanceIsPolicyBlock() public {
        vault.withdraw(payable(receiver), 10 ether);
        expectCheck(1, LeashVault.Decision.BLOCK, LeashVault.Reason.INSUFFICIENT_BALANCE);
        (, LeashVault.Reason r,) = pay(1);
        assertEq(uint256(r), uint256(LeashVault.Reason.INSUFFICIENT_BALANCE));
    }

    function testRecipientFailureRollsBackSpendAndPendingApproval() public {
        FailingReceiver bad = new FailingReceiver();
        vault.setReceiver(address(bad), true);
        vm.prank(agent);
        vm.expectRevert(LeashVault.CallFailed.selector);
        vault.pay(address(bad), 0.1 ether, 0);
        assertEq(vault.spentToday(), 0);
        assertEq(vault.actionsLastHour(), 0);
        vm.prank(agent);
        (,, uint256 id) = vault.pay(address(bad), 0.4 ether, 0);
        vm.expectRevert(LeashVault.CallFailed.selector);
        vault.approve(id);
        assertEq(uint256(vault.getRequest(id).status), uint256(LeashVault.Status.PENDING));
        assertEq(vault.spentToday(), 0);
        assertEq(vault.actionsLastHour(), 0);
        assertEq(address(vault).balance, 10 ether);
    }

    function testReentrantAgentBlockedAndEffectsPrecedeInteraction() public {
        ReentrantAgent attacker = new ReentrantAgent(vault);
        vault.setPolicy(address(attacker), p);
        vault.setReceiver(address(attacker), true);
        attacker.attack();
        assertEq(attacker.failure(), LeashVault.Reentrancy.selector);
        assertEq(attacker.observedSpent(), 0.1 ether);
        assertEq(attacker.observedActions(), 1);
        assertEq(vault.spentToday(), 0.1 ether);
        assertEq(address(attacker).balance, 0.1 ether);
    }

    function testOnlyAgentAndAgentRotation() public {
        vm.expectRevert(LeashVault.OnlyAgent.selector);
        vault.pay(receiver, 1, 0);
        vm.expectRevert(LeashVault.OnlyAgent.selector);
        vault.execute(receiver, 0, hex"12345678");
        pay(1);
        address nextAgent = makeAddr("nextAgent");
        vault.setPolicy(nextAgent, p);
        vm.prank(agent);
        vm.expectRevert(LeashVault.OnlyAgent.selector);
        vault.pay(receiver, 1, 0);
        assertEq(vault.spentToday(), 1);
        assertEq(vault.actionsLastHour(), 1);
        vm.prank(nextAgent);
        vault.pay(receiver, 1, 0);
    }

    function testOnlyOwnerEveryAdministrationEntryPoint() public {
        (,, uint256 id) = pay(0.4 ether);
        vm.startPrank(agent);
        vm.expectRevert(LeashVault.OnlyOwner.selector);
        vault.setPolicy(agent, p);
        vm.expectRevert(LeashVault.OnlyOwner.selector);
        vault.setReceiver(receiver, false);
        vm.expectRevert(LeashVault.OnlyOwner.selector);
        vault.setSelector(receiver, 0, true);
        vm.expectRevert(LeashVault.OnlyOwner.selector);
        vault.pause();
        vm.expectRevert(LeashVault.OnlyOwner.selector);
        vault.unpause();
        vm.expectRevert(LeashVault.OnlyOwner.selector);
        vault.withdraw(payable(agent), 1);
        vm.expectRevert(LeashVault.OnlyOwner.selector);
        vault.approve(id);
        vm.expectRevert(LeashVault.OnlyOwner.selector);
        vault.reject(id);
        (bool ok, bytes memory reason) = address(vault).call("");
        assertFalse(ok);
        assertEq(bytes4(reason), LeashVault.OnlyOwner.selector);
        vm.stopPrank();
    }

    function testOwnerDeposit() public {
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(vault).balance, 11 ether);
    }

    function testInvalidConfiguration() public {
        vm.expectRevert(LeashVault.InvalidAddress.selector);
        new LeashVault(address(0), agent);
        vm.expectRevert(LeashVault.InvalidAddress.selector);
        new LeashVault(address(this), address(0));
        vm.expectRevert(LeashVault.InvalidAddress.selector);
        vault.setPolicy(address(0), p);
        vm.expectRevert(LeashVault.InvalidAddress.selector);
        vault.setReceiver(address(0), true);
        vm.expectRevert(LeashVault.InvalidAddress.selector);
        vault.setSelector(address(0), 0, true);
        vm.expectRevert(LeashVault.InvalidAddress.selector);
        vault.withdraw(payable(address(0)), 0);
        p.activeStartMinute = 1440;
        vm.expectRevert(LeashVault.InvalidPolicy.selector);
        vault.setPolicy(agent, p);
        p.activeStartMinute = 0;
        p.activeEndMinute = 1440;
        vm.expectRevert(LeashVault.InvalidPolicy.selector);
        vault.setPolicy(agent, p);
        p.activeEndMinute = 0;
        p.utcOffsetMinutes = -721;
        vm.expectRevert(LeashVault.InvalidPolicy.selector);
        vault.setPolicy(agent, p);
        p.utcOffsetMinutes = 841;
        vm.expectRevert(LeashVault.InvalidPolicy.selector);
        vault.setPolicy(agent, p);
    }

    function testFuzzTotalSpentPerDayNeverExceedsCap(uint96 cap, uint256 seed) public {
        p.dailyCap = bound(uint256(cap), 1, 2 ether);
        p.perTxCap = p.dailyCap;
        p.askAboveAmount = p.dailyCap / 3;
        p.maxActionsPerHour = 100;
        vault.setPolicy(agent, p);
        uint256 totalTransferred;
        for (uint256 i; i < 32; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint256 amount = seed % (p.dailyCap + 1);
            (LeashVault.Decision d,, uint256 id) = pay(amount);
            if (d == LeashVault.Decision.ASK_HUMAN) (d,) = vault.approve(id);
            if (d == LeashVault.Decision.ALLOW) totalTransferred += amount;
            assertLe(vault.spentToday(), p.dailyCap);
            assertEq(receiver.balance, totalTransferred);
            if (i == 15) vm.warp(vm.getBlockTimestamp() + 1 days);
        }
    }
}

contract DeployTest is Test {
    function testDeploymentDefaultsAndOverridesWithoutBroadcasting() public {
        vm.setEnv("FUND_WEI", "0");
        vm.setEnv("AGENT_ADDRESS", "");
        // envOr uses the fallback for a missing/empty address.
        LeashVault v = (new Deploy()).run();
        assertEq(v.owner(), v.agent());
        assertEq(address(v).balance, 0);
        (uint256 daily, uint256 perTx, uint256 ask, uint32 rate, uint16 start, uint16 end, int16 offset) = v.policy();
        assertEq(daily, 0.0002 ether);
        assertEq(perTx, 0.00005 ether);
        assertEq(ask, 0.00003 ether);
        assertEq(rate, 5);
        assertEq(start, end);
        assertEq(offset, 330);
        assertTrue(v.receivers(address(uint160(uint256(keccak256("coffee"))))));
        assertTrue(v.receivers(address(uint160(uint256(keccak256("weather"))))));

        address sender = address(0x1234);
        vm.setEnv("AGENT_ADDRESS", vm.toString(sender));
        vm.setEnv("FUND_WEI", "12345");
        // startBroadcast() selects Foundry's default sender in local tests.
        vm.deal(address(0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38), 1 ether);
        v = (new Deploy()).run();
        assertEq(v.agent(), sender);
        assertEq(address(v).balance, 12345);
    }
}
