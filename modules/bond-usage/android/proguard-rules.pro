# expo-task-manager restores registered tasks by consumer class NAME
# (Class.forName) and creates it by reflection, so keep it if R8 runs.
-keep class com.bond.usage.CurrentAppTaskConsumer { *; }
-keep class com.bond.usage.CurrentAppService { *; }

# After Android restarts Bond's background service in a new process, Bond asks
# expo-task-manager to restore its task by creating TaskService through
# reflection (CurrentAppService.restoreTask), so keep that class and constructor.
-keep class expo.modules.taskManager.TaskService { <init>(android.content.Context); }
# Live app detection: the accessibility service is named in the manifest
# (kept by R8 automatically); keep its shared state object as well.
-keep class com.bond.usage.BondAppWatchService { *; }
-keep class com.bond.usage.LiveAppWatch { *; }
