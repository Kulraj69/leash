// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {LeashVault} from "../src/LeashVault.sol";

/// @notice Human-run Base Sepolia deployment; no key is read or stored by this script.
contract Deploy is Script {
    function run() external returns (LeashVault vault) {
        vm.startBroadcast();
        (,, address deployer) = vm.readCallers();
        address agent = vm.envOr("AGENT_ADDRESS", deployer);
        vault = new LeashVault{value: vm.envOr("FUND_WEI", uint256(0))}(deployer, agent);
        vault.setPolicy(
            agent,
            LeashVault.Policy({
                dailyCap: 0.0002 ether,
                perTxCap: 0.00005 ether,
                askAboveAmount: 0.00003 ether,
                maxActionsPerHour: 5,
                activeStartMinute: 0,
                activeEndMinute: 0,
                utcOffsetMinutes: 330
            })
        );
        vault.setReceiver(address(uint160(uint256(keccak256("coffee")))), true);
        vault.setReceiver(address(uint160(uint256(keccak256("weather")))), true);
        vm.stopBroadcast();
    }
}

