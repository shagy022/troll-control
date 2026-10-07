# TROLL Control v0.1
Mobile-first PWA simulator/prototype for the DIY 36V GPS trolling motor.

Current: throttle, steering, forward/reverse state, Spot Lock toggle, Heading Hold, Cruise, emergency STOP, simulated telemetry, battery dashboard and installable PWA shell.

Hardware integration will remain separated from the UI. Planned path: Android/PWA -> ESP32 bridge -> Pixhawk/ArduPilot -> steering and propulsion controller. Bluetooth BMS telemetry will be added once the battery/BMS protocol is identified. Safety/failsafe authority remains onboard rather than relying on the phone.