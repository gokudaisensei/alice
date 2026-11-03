<script lang="ts">
	import Page from '#lib/components/app/Page.svelte';
	import NotificationSettings from '#lib/components/app/NotificationSettings.svelte';
</script>

<Page title="Notifications" subtitle="Choose what is worth interrupting you for." back={{ href: '/you', label: 'You' }} width="md">
	<NotificationSettings />
</Page>
