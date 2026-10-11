// App entry. The background jobs must be defined before anything else so
// Android can run them even when Bond starts without opening a screen.
import './src/lib/backgroundJobs';
import 'expo-router/entry';
