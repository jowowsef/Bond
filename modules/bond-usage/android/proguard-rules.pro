# expo-task-manager restores registered tasks by consumer class NAME
# (Class.forName) and creates it by reflection, so keep it if R8 runs.
-keep class com.bond.usage.CurrentAppTaskConsumer { *; }
-keep class com.bond.usage.CurrentAppService { *; }
