import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import DashboardPage from './pages/DashboardPage.vue';
import DashboardMonthDetailPage from './pages/DashboardMonthDetailPage.vue';
import MessagesPage from './pages/MessagesPage.vue';
import HistoriesPage from './pages/HistoriesPage.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', component: DashboardPage },
    { path: '/dashboard/month/:monthKey', component: DashboardMonthDetailPage },
    { path: '/messages', component: MessagesPage },
    { path: '/histories', component: HistoriesPage },
  ],
});

createApp(App).use(router).mount('#app');
