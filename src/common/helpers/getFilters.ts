type Filters = { [key: string]: string };
type DynamicFilter = { [key: string]: string };

export const getFilters = (filters: Filters): DynamicFilter => {
    const filter: DynamicFilter = {};
    for (const key in filters) {
        if (filters.hasOwnProperty(key)) {
            const value = filters[key];
            filter[key] = value;
        }
    }

    const cleanFilter = Object.fromEntries(Object.entries(filter).filter(([_, value]) => value !== undefined && value !== 'undefined' && value !== '' && value !== null));
    return cleanFilter;
};

