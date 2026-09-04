class PaginatedResult<T> {
  const PaginatedResult({required this.items, required this.hasMore});
  final List<T> items;
  final bool hasMore;
}
